-- S2 holds + collection (docs/superpowers/specs/2026-09-07-s2-holds-collection-design.md).
-- A rental booking whose deposit is due on an org with an active payment
-- account is inserted as 'pending_payment' with hold_expires_at, holds its
-- slot under the EXCLUDE guards, is confirmed by apply_booking_payment
-- (webhook) or mark_booking_paid (admin), and is flipped to 'expired' by
-- the drain when the hold lapses.
-- Deploy note: resolve_booking_token's return type changes (drop/create)
-- and five RPC bodies change — migrate and deploy the build in one window.

-- ---------- bookings: statuses + money columns
alter table public.bookings drop constraint bookings_status_check;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','pending','pending_payment','declined','expired',
       'cancelled_by_client','cancelled_by_provider','rescheduled'));
--> statement-breakpoint
alter table public.bookings
  add column hold_expires_at timestamptz,
  add column paid_cents integer not null default 0,
  add column refunded_cents integer not null default 0;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_hold_ck check (status <> 'pending_payment' or hold_expires_at is not null),
  add constraint bookings_paid_ck check (paid_cents >= 0),
  add constraint bookings_refunded_ck check (refunded_cents >= 0 and refunded_cents <= paid_cents);
--> statement-breakpoint
-- The drain's scan: live holds ordered by deadline.
create index bookings_hold_expires_idx on public.bookings (hold_expires_at) where status = 'pending_payment';
--> statement-breakpoint

-- ---------- EXCLUDE guards (0062 bodies, predicate widened): a hold reserves
-- its slot exactly as a pending request does.
alter table public.bookings drop constraint bookings_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending','pending_payment') and staff_id is not null);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_rental_unit_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_rental_unit_no_overlap
  exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending','pending_payment') and rental_unit_id is not null);
--> statement-breakpoint

-- ---------- Free-check helpers (0062 bodies, one predicate widened). They
-- mirror the EXCLUDE predicate: a pre-check that disagrees with the
-- constraint turns an authorised insert into a 23P01.
create or replace function public.staff_is_free(
  p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.staff_id = p_staff_id and b.status in ('confirmed','pending','pending_payment')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at));
$$;
revoke all on function public.staff_is_free(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.pick_staff_for_slot(
  p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_exclude uuid[], p_candidates uuid[] default null
) returns uuid language sql stable set search_path = '' as $$
  select st.id
  from public.service_staff ss
  join public.staff st on st.id = ss.staff_id
  where ss.service_id = p_service_id and st.active
    and st.id <> all(coalesce(p_exclude, '{}'::uuid[]))
    and (p_candidates is null or st.id = any(p_candidates))
    and public.slot_within_availability(st.id, p_timezone, p_starts_at, p_ends_at)
    and public.staff_is_free(st.id, p_starts_at, p_ends_at, null)
  order by (
      select count(*) from public.bookings b
      where b.staff_id = st.id and b.status in ('confirmed','pending','pending_payment')
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[], uuid[])
  from public, anon, authenticated, service_role;

create or replace function public.rental_unit_is_free(
  p_unit_id uuid, p_timezone text, p_range_mode text, p_occ_start date, p_occ_end date,
  p_turnover int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status in ('confirmed','pending','pending_payment')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and daterange((b.starts_at at time zone p_timezone)::date,
                      greatest((b.starts_at at time zone p_timezone)::date,
                               (b.ends_at at time zone p_timezone)::date
                                 - case when p_range_mode = 'nights' then 1 else 0 end
                                 + p_turnover), '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'));
$$;
revoke all on function public.rental_unit_is_free(uuid, text, text, date, date, int, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.rental_unit_is_free_hours(
  p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_turnover_min int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange((p_starts_at at time zone p_timezone)::date,
                         (p_ends_at   at time zone p_timezone)::date, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status in ('confirmed','pending','pending_payment')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and tstzrange(b.starts_at, b.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;

-- ---------- Admin cancel seam (0028): a member may also cancel a hold.
drop policy "bookings_update_member" on public.bookings;
--> statement-breakpoint
create policy "bookings_update_member" on public.bookings
  for update to authenticated
  using (org_id in (select public.user_orgs()) and status in ('confirmed','pending_payment'))
  with check (org_id in (select public.user_orgs()) and status = 'cancelled_by_provider');
--> statement-breakpoint

-- ---------- Tables. service_role only (0076's calendar_connections idiom):
-- every read goes through server code after requireOrg, every write through
-- the admin client or a definer RPC.
create table public.payment_accounts (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_account_id text not null unique,
  status text not null default 'onboarding' check (status in ('onboarding','active','restricted')),
  capabilities jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
alter table public.payment_accounts enable row level security;
--> statement-breakpoint
revoke all on table public.payment_accounts from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on table public.payment_accounts to service_role;
--> statement-breakpoint

create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('deposit')),
  provider text not null check (provider in ('stripe','fake','manual')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  status text not null check (status in ('pending','processing','paid','failed','expired','refunded','refund_failed')),
  stripe_account_id text,
  checkout_session_id text unique,
  checkout_url text,
  checkout_expires_at timestamptz,
  payment_intent_id text,
  paid_at timestamptz,
  refund_id text,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index booking_payments_booking_id_idx on public.booking_payments (booking_id, created_at desc);
--> statement-breakpoint
alter table public.booking_payments enable row level security;
--> statement-breakpoint
revoke all on table public.booking_payments from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on table public.booking_payments to service_role;
--> statement-breakpoint

-- ---------- orgs: hold window + legal identity (select-only table, 0004 —
-- written by update_org_payments below).
alter table public.orgs
  add column payment_hold_min integer not null default 60,
  add column legal jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table public.orgs
  add constraint orgs_payment_hold_ck check (payment_hold_min in (30, 60, 180, 1440)),
  add constraint orgs_legal_ck check (jsonb_typeof(legal) = 'object');
--> statement-breakpoint

create function public.update_org_payments(p_org_id uuid, p_hold_min int, p_legal jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  if p_hold_min is null or p_hold_min not in (30, 60, 180, 1440) then raise exception 'invalid hold'; end if;
  if p_legal is null or jsonb_typeof(p_legal) <> 'object' then raise exception 'invalid legal'; end if;
  update public.orgs set payment_hold_min = p_hold_min, legal = p_legal where id = p_org_id;
end; $$;
revoke all on function public.update_org_payments(uuid, int, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_org_payments(uuid, int, jsonb) to authenticated;

-- ---------- create_rental_booking_hours (base: 0078): the inserted status
-- becomes three-way and the hold is stamped.
create or replace function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
  p_people int, p_extras jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
  v_pay boolean; v_hold int;                                        -- S2
begin
  select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;
  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  -- S1: the quote replaces rental_total_cents.
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb));
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
    where b.org_id = v_org.id and lower(b.client_email) = lower(p_email)
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

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people, hold_expires_at)                                                -- S1/S2
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends,
     case when v_off.requires_approval then 'pending'
          when v_pay then 'pending_payment' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end,  -- S1
     case when v_off.pricing ? 'people' then coalesce(p_people, (v_off.pricing->'people'->>'included')::int) end,  -- S1
     case when (not v_off.requires_approval) and v_pay
          then least(now() + make_interval(mins => v_hold), p_starts_at) end)       -- S2
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb) to service_role;

-- ---------- create_rental_booking (base: 0062, nights/days): same three-way.
create or replace function public.create_rental_booking(
  p_handle text,
  p_offering_id uuid,
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_name text,
  p_email text,
  p_note text,
  p_token_hash text
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
begin
  select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;

  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active;
  if v_off.id is null then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
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

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     hold_expires_at)                                                                 -- S2
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
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

revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text) to service_role;

-- ---------- accept_booking (base: 0063): pending -> pending_payment when a
-- deposit is due on an active account, else confirmed.
create or replace function public.accept_booking(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_pay boolean;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select coalesce(b.deposit_cents, 0) > 0
         and exists (select 1 from public.payment_accounts pa where pa.org_id = b.org_id and pa.status = 'active')
    into v_pay
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs());
  if v_pay is null then raise exception 'not found'; end if;
  -- pending -> confirmed/pending_payment cannot violate the overlap guards:
  -- the row already holds its slot under the widened EXCLUDE (0062/0079).
  update public.bookings b
    set status = case when v_pay then 'pending_payment' else 'confirmed' end,
        hold_expires_at = case when v_pay
          then least(now() + make_interval(mins => (select o.payment_hold_min from public.orgs o where o.id = b.org_id)), b.starts_at) end
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'pending'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;
  return v_id;
end; $$;
revoke all on function public.accept_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_booking(uuid) to authenticated;

-- ---------- Money follows a reschedule. A reschedule writes a NEW row
-- (rescheduled_from_id → the old one; six RPCs across 0058/0062/0070/0078).
-- Rather than re-issue them, the 0072 carry trigger grows two rules: the new
-- row inherits paid/refunded cents, and the ledger is re-pointed at it after
-- the insert so a later refund finds the money on the live booking.
create or replace function public.carry_booking_locale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    if new.locale is null then
      select b.locale into new.locale from public.bookings b where b.id = new.rescheduled_from_id;
    end if;
    -- S2: money carries (spec §Flows "Reschedule": paid_cents carries).
    select b.paid_cents, b.refunded_cents into new.paid_cents, new.refunded_cents
      from public.bookings b where b.id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
create or replace function public.carry_booking_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    update public.booking_payments set booking_id = new.id, updated_at = now()
      where booking_id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
revoke all on function public.carry_booking_payments() from public, anon, authenticated, service_role;
drop trigger if exists bookings_payments_carry on public.bookings;
create trigger bookings_payments_carry
  after insert on public.bookings
  for each row execute function public.carry_booking_payments();

-- ---------- rotate_booking_token (base: 0064): a hold's link can be resent
-- and is rotated by the accept action.
create or replace function public.rotate_booking_token(
  p_booking_id uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  update public.bookings b
    set cancel_token_hash = p_token_hash
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status in ('confirmed','pending','pending_payment')
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;

  return v_id;
end;
$$;

revoke all on function public.rotate_booking_token(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rotate_booking_token(uuid, text) to authenticated;

-- ---------- cancel_booking (base: 0070): a hold withdraws unconditionally,
-- like a pending request (nothing was paid yet).
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash and b.starts_at > now()
      and (b.status in ('pending','pending_payment')
        -- H3: a CONFIRMED rental inside its free-cancellation window cannot
        -- self-cancel; a pending request or a payment hold (S2 — nothing
        -- was paid yet) is always withdrawable.
        or (b.status = 'confirmed'
          and (b.rental_offering_id is null or not exists (
            select 1 from public.rental_offerings ro
            where ro.id = b.rental_offering_id
              and ro.cancel_window_min > 0
              and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)))))
    returning b.id into v_id;
  if v_id is null then
    -- Distinguish "window passed" from a dead token so the manage page can
    -- say so (sentinel idiom: single lowercase word).
    if exists (
      select 1 from public.bookings b
      join public.rental_offerings ro on ro.id = b.rental_offering_id
      where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
        and ro.cancel_window_min > 0
        and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)
    ) then
      raise exception 'cancel_window';
    end if;
    return;
  end if;
  return query
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, public.booking_title(ro.name, u.name)),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to service_role;

-- ---------- resolve_booking_token (base: 0078): + hold_expires_at,
-- paid_cents, refunded_cents (return type changes: drop + create).
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int, decline_note text,
  lines jsonb, people int,
  hold_expires_at timestamptz, paid_cents int, refunded_cents int                  -- S2
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min, b.decline_note,
           b.lines, b.people,
           b.hold_expires_at, b.paid_cents, b.refunded_cents                          -- S2
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon, service_role;

-- ---------- apply_booking_payment: the webhook's one write. Idempotent on
-- the ledger row; confirms a hold, revives an expired hold when the slot is
-- still free, and reports slot_lost otherwise (the caller refunds).
create function public.apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pay record; v_status text;
begin
  select bp.id, bp.booking_id, bp.status into v_pay
    from public.booking_payments bp where bp.checkout_session_id = p_session_id for update;
  if v_pay.id is null then return 'unknown'; end if;
  if v_pay.status in ('paid','refunded','refund_failed') then return 'replayed'; end if;

  update public.booking_payments
    set status = 'paid', payment_intent_id = p_payment_intent_id, amount_cents = p_amount_cents,
        paid_at = now(), updated_at = now()
    where id = v_pay.id;

  select b.status into v_status from public.bookings b where b.id = v_pay.booking_id for update;
  if v_status = 'pending_payment' then
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
      where id = v_pay.booking_id;
    return 'confirmed';
  elsif v_status = 'expired' then
    -- The hold lapsed before the money landed: take the slot back if it is
    -- still free. The EXCLUDE guard is the arbiter.
    begin
      update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
        where id = v_pay.booking_id;
      return 'confirmed';
    exception when exclusion_violation then
      return 'slot_lost';
    end;
  else
    return 'slot_lost';
  end if;
end; $$;
revoke all on function public.apply_booking_payment(text, text, int) from public, anon, authenticated, service_role;
grant execute on function public.apply_booking_payment(text, text, int) to service_role;

-- ---------- mark_booking_paid: the admin's escape hatch for a transfer
-- received off-platform.
create function public.mark_booking_paid(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b record;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id, b.org_id, b.deposit_cents, b.currency into v_b
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs())
      and b.status = 'pending_payment' for update;
  if v_b.id is null then raise exception 'not found'; end if;
  insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
    values (v_b.org_id, v_b.id, 'deposit', 'manual', v_b.deposit_cents, coalesce(v_b.currency, 'PLN'), 'paid', now());
  update public.bookings set status = 'confirmed', paid_cents = paid_cents + v_b.deposit_cents where id = v_b.id;
  return v_b.id;
end; $$;
revoke all on function public.mark_booking_paid(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_booking_paid(uuid) to authenticated;
--> statement-breakpoint

-- ---------- bump_booking_refunded: the refund path's one write on the
-- booking (PostgREST cannot express `refunded_cents = refunded_cents + n`).
-- least(): a slot_lost refund returns money the BOOKING never counted as
-- paid — the confirm was rolled back by the EXCLUDE guard — and
-- bookings_refunded_ck caps refunded_cents at paid_cents. Clamp instead of
-- raising: the ledger row is the record of what was actually refunded.
create function public.bump_booking_refunded(p_booking_id uuid, p_cents int)
returns void language sql security definer set search_path = '' as $$
  update public.bookings set refunded_cents = least(refunded_cents + p_cents, paid_cents)
    where id = p_booking_id;
$$;
--> statement-breakpoint
revoke all on function public.bump_booking_refunded(uuid, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.bump_booking_refunded(uuid, int) to service_role;

-- Rollback: drop trigger bookings_payments_carry + carry_booking_payments,
-- `create or replace` carry_booking_locale from 0072; drop
-- bump_booking_refunded, mark_booking_paid, apply_booking_payment,
-- update_org_payments;
-- drop and recreate resolve_booking_token from 0078; `create or replace`
-- create_rental_booking_hours from 0078, create_rental_booking from 0062,
-- accept_booking from 0063, rotate_booking_token from 0064, cancel_booking
-- from 0070, the four free-check helpers from 0062; recreate policy
-- bookings_update_member from 0028 and both EXCLUDE guards from 0062;
--   alter table public.orgs drop column payment_hold_min, drop column legal;
--   drop table public.booking_payments; drop table public.payment_accounts;
--   alter table public.bookings drop column hold_expires_at, drop column paid_cents, drop column refunded_cents;
-- and restore 0062's bookings_status_check (any 'pending_payment'/'expired'
-- rows must be cancelled first).
