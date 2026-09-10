-- 0086 booking phone: the client's phone number, and what the org asks for.
-- orgs.client_contact ('email' | 'phone' | 'both', default 'email' = today's
-- behaviour) decides which contact fields the public form shows and the
-- public create RPCs REQUIRE; admin forms keep both optional (walk-ins).
--
-- Deploy note: the three public create RPCs change signature (drop/create,
-- + p_phone) — ship migration and code in one window (0084 precedent).
-- Everything else is additive.

ALTER TABLE "orgs" ADD COLUMN "client_contact" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_phone" text;--> statement-breakpoint

alter table public.orgs
  add constraint orgs_client_contact_check check (client_contact in ('email', 'phone', 'both'));
--> statement-breakpoint
-- Stored form: digits with an optional leading '+', as client_contact_phone
-- normalises it. No length floor beyond the format — an admin may paste a
-- short internal extension; the public RPC is the strict gate.
alter table public.bookings
  add constraint bookings_client_phone_format check (client_phone ~ '^\+?[0-9]{3,20}$');
--> statement-breakpoint
alter table public.clients
  add constraint clients_phone_format check (phone ~ '^\+?[0-9]{3,20}$');
--> statement-breakpoint
-- A client with no address is keyed by phone (mirror of the 0026
-- (org_id, lower(email)) partial key). Hand-made clients with neither stay
-- unconstrained, as before.
create unique index clients_org_phone_key on public.clients (org_id, phone) where email is null;
--> statement-breakpoint
-- Ordinary member RLS + grants (0018/0026) already cover the new columns:
-- clients is member CRUD, bookings.client_phone rides the table's select
-- grant. The admin create actions stamp client_phone as service_role after
-- their RPC (the 0072 locale idiom — three more ~100-line bodies not worth
-- re-issuing for a pass-through), which 0026's service_role UPDATE covers.

-- ---------- the org's setting. Same shape as update_org_notification_prefs
-- (0075): membership gate, value CHECK, one UPDATE.
create or replace function public.update_org_client_contact(p_org_id uuid, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_value not in ('email', 'phone', 'both') then raise exception 'not found'; end if;
  update public.orgs set client_contact = p_value where id = p_org_id;
end; $$;
--> statement-breakpoint
revoke all on function public.update_org_client_contact(uuid, text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.update_org_client_contact(uuid, text) to authenticated;
--> statement-breakpoint

-- ---------- the one gate the three public RPCs share: formats, plus "did the
-- client give what this org collects". Returns the phone as stored. A field
-- the org does not ask for is still accepted when present (harmless, and the
-- admin path stores both anyway). Internal to the definer RPCs, like
-- reserved_handles (0066).
create or replace function public.client_contact_phone(p_contact text, p_email text, p_phone text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_phone text;
begin
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'not found';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then raise exception 'not found'; end if;
  if p_contact in ('email', 'both') and p_email is null then raise exception 'not found'; end if;
  if p_contact in ('phone', 'both') and v_phone is null then raise exception 'not found'; end if;
  return v_phone;
end; $$;
--> statement-breakpoint
revoke all on function public.client_contact_phone(text, text, text) from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- a reschedule writes a NEW row with an explicit column list (the
-- 0072 note); the phone rides along the same way the locale does.
create or replace function public.carry_booking_phone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.client_phone is null and new.rescheduled_from_id is not null then
    select b.client_phone into new.client_phone from public.bookings b where b.id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
--> statement-breakpoint
drop trigger if exists bookings_phone_carry on public.bookings;
--> statement-breakpoint
create trigger bookings_phone_carry
  before insert on public.bookings
  for each row execute function public.carry_booking_phone();
--> statement-breakpoint

-- ---------- create_booking (base: 0062 lines 149–246): + p_phone, the
-- contact gate replaces the inline email check, the hourly cap counts either
-- contact, the client upsert keys by whichever the client gave.
drop function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[]);
--> statement-breakpoint
create function public.create_booking(
  p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_note text, p_token_hash text, p_staff_id uuid default null, p_candidates uuid[] default null,
  p_phone text default null
) returns table (booking_id uuid, staff_id uuid, staff_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_org record;
  v_service record;
  v_recent int;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
  v_staff uuid;
  v_tried uuid[] := '{}';
  v_attempts int := 0;
  v_phone text;
begin
  select o.id, o.timezone, o.offers_appointments, o.client_contact into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_appointments then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days, s.requires_approval into v_service
    from public.services s where s.id = p_service_id and s.org_id = v_org.id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  v_phone := public.client_contact_phone(v_org.client_contact, p_email, p_phone);
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  -- One address, one org, five rows an hour (any status — reschedules
  -- create rows too). Bounds the confirmation-mail and calendar-fill loops
  -- a single address could otherwise drive; a distinct sentinel so the
  -- action can say so instead of "try again".
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id
      and ((p_email is not null and lower(b.client_email) = lower(p_email))
        or (v_phone is not null and b.client_phone = v_phone))
      and b.created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'too_many'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  if p_staff_id is not null then
    -- Named staff: must be active, in the org, offering the service, inside hours.
    if not exists (
      select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
      where st.id = p_staff_id and st.org_id = v_org.id and st.active and ss.service_id = p_service_id
    ) then raise exception 'staff_unavailable'; end if;
    if not public.slot_within_availability(p_staff_id, v_org.timezone, p_starts_at, v_ends_at) then
      raise exception 'not found';
    end if;
    v_staff := p_staff_id;
  else
    -- Auto-assign. If no eligible staff is even open at this time -> not found
    -- (uniform); if all open ones are busy -> taken.
    if not exists (
      select 1 from public.service_staff ss join public.staff st on st.id = ss.staff_id
      where ss.service_id = p_service_id and st.active
        and (p_candidates is null or st.id = any(p_candidates))
        and public.slot_within_availability(st.id, v_org.timezone, p_starts_at, v_ends_at)
    ) then raise exception 'not found'; end if;
  end if;

  -- 0086: an address keys the client (and learns the phone); without one the
  -- phone keys it (clients_org_phone_key). Never both — a client who booked by
  -- phone once and by email later is two rows, which the directory can merge.
  if p_email is not null then
    insert into public.clients (org_id, name, email, phone)
    values (v_org.id, btrim(p_name), lower(p_email), v_phone)
    on conflict (org_id, lower(email)) where email is not null
    do update set name = clients.name, phone = coalesce(excluded.phone, clients.phone)
    returning id into v_client_id;
  else
    insert into public.clients (org_id, name, phone)
    values (v_org.id, btrim(p_name), v_phone)
    on conflict (org_id, phone) where email is null
    do update set name = clients.name
    returning id into v_client_id;
  end if;

  loop
    if p_staff_id is null then
      v_staff := public.pick_staff_for_slot(p_service_id, v_org.timezone, p_starts_at, v_ends_at, v_tried, p_candidates);
      if v_staff is null then raise exception 'taken'; end if;
    end if;
    begin
      insert into public.bookings
        (org_id, service_id, staff_id, client_id, client_name, client_email, client_phone,
         starts_at, ends_at, status, cancel_token_hash, note)
      values
        (v_org.id, p_service_id, v_staff, v_client_id, btrim(p_name), lower(p_email), v_phone,
         p_starts_at, v_ends_at,
         case when v_service.requires_approval then 'pending' else 'confirmed' end,
         p_token_hash, p_note)
      returning id into v_booking_id;
      exit;
    exception when exclusion_violation then
      -- Named staff: surface as the classic 23P01 so callers keep their
      -- "slot taken" mapping. Auto: try the next eligible staff (race lost).
      if p_staff_id is not null then raise; end if;
      v_tried := v_tried || v_staff;
      v_attempts := v_attempts + 1;
      if v_attempts > 20 then raise exception 'taken'; end if;
    end;
  end loop;

  return query select v_booking_id, v_staff, st.name from public.staff st where st.id = v_staff;
end; $$;
--> statement-breakpoint
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[], text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[], text) to service_role;
--> statement-breakpoint

-- ---------- create_rental_booking (base: 0079 lines 310–440): same edits.
drop function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text);
--> statement-breakpoint
create function public.create_rental_booking(
  p_handle text,
  p_offering_id uuid,
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_name text,
  p_email text,
  p_note text,
  p_token_hash text,
  p_phone text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_off record;
  v_today date;
  v_len int;
  v_night_adj int;
  v_occ_start date;
  v_occ_end date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_unit uuid;
  v_client_id uuid;
  v_booking_id uuid;
  v_recent int;
  v_total int;
  v_deposit int;
  v_snap_currency text;
  v_pay boolean;    -- S2
  v_hold int;       -- S2
  v_phone text;     -- 0086
begin
  select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min, o.client_contact into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;

  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active;
  if v_off.id is null then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  v_phone := public.client_contact_phone(v_org.client_contact, p_email, p_phone);
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'not found'; end if;

  v_today := (now() at time zone v_org.timezone)::date;
  if p_start_date < v_today + v_off.min_notice_days then raise exception 'not found'; end if;
  if p_end_date > v_today + v_off.booking_window_days then raise exception 'not found'; end if;

  if v_off.range_mode = 'nights' then
    if p_end_date <= p_start_date then raise exception 'not found'; end if;
    v_len := p_end_date - p_start_date;
    v_night_adj := 1;
  else
    if p_end_date < p_start_date then raise exception 'not found'; end if;
    v_len := p_end_date - p_start_date + 1;
    v_night_adj := 0;
  end if;
  if v_len < v_off.min_stay then raise exception 'not found'; end if;
  if v_off.max_stay is not null and v_len > v_off.max_stay then raise exception 'not found'; end if;
  v_occ_start := p_start_date;
  v_occ_end := p_end_date - v_night_adj;
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_len);
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;

  v_starts := (p_start_date::text || ' ' || v_off.start_time)::timestamp at time zone v_org.timezone;
  v_ends := (p_end_date::text || ' ' || v_off.end_time)::timestamp at time zone v_org.timezone;
  -- Reject a stay whose check-in has already passed (not just one that has
  -- already ended): cancel_booking requires starts_at > now(), so a booking
  -- made after today's check-in time would be uncancellable. Mirrors
  -- create_booking (0034).
  if v_ends <= v_starts or v_starts <= now() then raise exception 'not found'; end if;

  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;

  -- S2: a deposit on an org with an active payment account is collected
  -- online — the row is held, not confirmed. Approval still comes first.
  v_pay := coalesce(v_deposit, 0) > 0
       and exists (select 1 from public.payment_accounts pa where pa.org_id = v_org.id and pa.status = 'active');
  v_hold := v_org.payment_hold_min;

  -- Serialize per offering: two concurrent auto-assignments must not both
  -- pick the same unit, and turnover-only conflicts are invisible to the
  -- EXCLUDE guard (which stays as the physical-overlap backstop).
  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  select u.id into v_unit
    from public.rental_units u
    where u.offering_id = v_off.id and u.active
      and (p_unit_id is null or u.id = p_unit_id)
      and public.rental_unit_is_free(u.id, v_org.timezone, v_off.range_mode,
                                     v_occ_start, v_occ_end, v_off.turnover_days, null)
    order by u.sort_order, u.created_at
    limit 1;
  if v_unit is null then raise exception 'taken'; end if;

  -- 0086: an address keys the client (and learns the phone); without one the
  -- phone keys it (clients_org_phone_key). Never both — a client who booked by
  -- phone once and by email later is two rows, which the directory can merge.
  if p_email is not null then
    insert into public.clients (org_id, name, email, phone)
    values (v_org.id, btrim(p_name), lower(p_email), v_phone)
    on conflict (org_id, lower(email)) where email is not null
    do update set name = clients.name, phone = coalesce(excluded.phone, clients.phone)
    returning id into v_client_id;
  else
    insert into public.clients (org_id, name, phone)
    values (v_org.id, btrim(p_name), v_phone)
    on conflict (org_id, phone) where email is null
    do update set name = clients.name
    returning id into v_client_id;
  end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email, client_phone,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     hold_expires_at)                                                                 -- S2
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email), v_phone,
     v_starts, v_ends,
     case when v_off.requires_approval then 'pending'
          when v_pay then 'pending_payment' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when (not v_off.requires_approval) and v_pay
          then least(now() + make_interval(mins => v_hold), v_starts) end)            -- S2
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

--> statement-breakpoint
revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text, text) to service_role;
--> statement-breakpoint

-- ---------- create_rental_booking_hours (base: 0084 lines 297–407): same edits.
drop function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb);
--> statement-breakpoint
create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
  p_people int, p_extras jsonb, p_equipment jsonb default '[]'::jsonb,
  p_phone text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
  v_pay boolean; v_hold int;                                        -- S2
  v_equip jsonb; v_status text;   -- S6
  v_phone text;                   -- 0086
begin
  select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min, o.client_contact into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;
  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;
  -- S6: equipment is an add-on, never the room (ruling 5/9).
  if v_off.kind = 'equipment' then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  v_phone := public.client_contact_phone(v_org.client_contact, p_email, p_phone);
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  -- S1: the quote replaces rental_total_cents.
  v_equip := public.rental_equipment_lines(v_org.id, coalesce(p_equipment, '[]'::jsonb), p_duration_min);   -- S6
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb)) || v_equip;
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;
  if p_starts_at <= now() + make_interval(mins => v_off.min_notice_min) then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_off.booking_window_days + 1) then raise exception 'not found'; end if;
  if not public.slot_within_offering_availability(v_off.id, v_org.timezone, p_starts_at, v_ends) then
    raise exception 'not found';
  end if;

  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  -- Per-email hourly cap (0052 idiom — the rentals date RPCs predate it;
  -- hourly starts hardened).
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id
      and ((p_email is not null and lower(b.client_email) = lower(p_email))
        or (v_phone is not null and b.client_phone = v_phone))
      and b.created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'too_many'; end if;

  -- S2: a deposit on an org with an active payment account is collected
  -- online — the row is held, not confirmed. Approval still comes first.
  v_pay := coalesce(v_deposit, 0) > 0
       and exists (select 1 from public.payment_accounts pa where pa.org_id = v_org.id and pa.status = 'active');
  v_hold := v_org.payment_hold_min;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  select u.id into v_unit
    from public.rental_units u
    where u.offering_id = v_off.id and u.active
      and (p_unit_id is null or u.id = p_unit_id)
      and public.rental_unit_is_free_hours(u.id, v_org.timezone, p_starts_at, v_ends,
                                           v_off.turnover_min, null)
    order by u.sort_order, u.created_at
    limit 1;
  if v_unit is null then raise exception 'taken'; end if;

  -- 0086: an address keys the client (and learns the phone); without one the
  -- phone keys it (clients_org_phone_key). Never both — a client who booked by
  -- phone once and by email later is two rows, which the directory can merge.
  if p_email is not null then
    insert into public.clients (org_id, name, email, phone)
    values (v_org.id, btrim(p_name), lower(p_email), v_phone)
    on conflict (org_id, lower(email)) where email is not null
    do update set name = clients.name, phone = coalesce(excluded.phone, clients.phone)
    returning id into v_client_id;
  else
    insert into public.clients (org_id, name, phone)
    values (v_org.id, btrim(p_name), v_phone)
    on conflict (org_id, phone) where email is null
    do update set name = clients.name
    returning id into v_client_id;
  end if;

  v_status := case when v_off.requires_approval then 'pending'
                   when v_pay then 'pending_payment' else 'confirmed' end;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email, client_phone,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people, hold_expires_at)                                                -- S1/S2
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email), v_phone,
     p_starts_at, v_ends,
     v_status,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when jsonb_array_length(v_lines) = 0 then null
          when v_off.pricing is null and jsonb_array_length(v_equip) = 0 then null
          else v_lines end,                                                            -- S1/S6
     case when v_off.pricing ? 'people' then coalesce(p_people, (v_off.pricing->'people'->>'included')::int) end,  -- S1
     case when (not v_off.requires_approval) and v_pay
          then least(now() + make_interval(mins => v_hold), p_starts_at) end)       -- S2
  returning id into v_booking_id;

  -- S6: the trigger has written the primary (+ component) rows; equipment
  -- is explicit. Runs inside the same transaction — a lost race rolls the
  -- booking back with 'taken'.
  perform public.attach_booking_equipment(v_booking_id, v_org.id, v_org.timezone, coalesce(p_equipment, '[]'::jsonb),
                                          p_starts_at, v_ends, v_status in ('confirmed','pending','pending_payment'), null);

  return v_booking_id;
end; $$;
--> statement-breakpoint
--> statement-breakpoint
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
--> statement-breakpoint
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb, text) to service_role;
