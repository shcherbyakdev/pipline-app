-- H3 prices & terms (part A): CHECKs, money helpers, org currency RPC.
-- Part B (booking RPC money snapshot + cancel window) is appended below in
-- a later task of the same slice.

-- ---------- CHECKs (columns added by 0057)
alter table public.rental_offerings
  add constraint rental_offerings_price_cents_ck
    check (price_cents is null or price_cents >= 0),
  add constraint rental_offerings_pricing_mode_ck
    check (pricing_mode in ('per_unit','flat')),
  add constraint rental_offerings_deposit_type_ck
    check (deposit_type in ('none','fixed','percent','full')),
  add constraint rental_offerings_deposit_value_ck check (
    case deposit_type
      when 'fixed'   then deposit_value is not null and deposit_value >= 0
      when 'percent' then deposit_value between 1 and 100
      else deposit_value is null
    end),
  -- percent/full are fractions of a price; fixed may stand alone
  -- ("free to book, damage deposit at the venue").
  add constraint rental_offerings_deposit_needs_price_ck
    check (deposit_type not in ('percent','full') or price_cents is not null),
  add constraint rental_offerings_cancel_window_ck
    check (cancel_window_min >= 0);

alter table public.orgs
  add constraint orgs_currency_ck
    check (currency in ('PLN','EUR','USD','GBP','CZK'));

alter table public.bookings
  add constraint bookings_money_ck
    check ((price_cents is null or price_cents >= 0)
       and (deposit_cents is null or deposit_cents >= 0));

-- ---------- Money helpers (mirrored by src/features/rentals/pricing.ts —
-- keep the two in lockstep). p_units: nights/days count, or duration/60.
create function public.rental_total_cents(p_mode text, p_price int, p_units numeric)
returns int language sql immutable as $$
  select case when p_price is null then null
              when p_mode = 'flat' then p_price
              else round(p_price * p_units)::int end;
$$;
revoke all on function public.rental_total_cents(text, int, numeric)
  from public, anon, authenticated;

create function public.rental_deposit_cents(p_type text, p_value int, p_total int)
returns int language sql immutable as $$
  select case p_type
           when 'full'    then p_total
           when 'percent' then case when p_total is null then null
                                    else round(p_total * p_value / 100.0)::int end
           when 'fixed'   then case when p_total is null then p_value
                                    else least(p_value, p_total) end
           else null end;
$$;
revoke all on function public.rental_deposit_cents(text, int, int)
  from public, anon, authenticated;

-- ---------- update_org_scheduling: + currency (signature change → drop).
drop function public.update_org_scheduling(uuid, text, text);
create function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text,
  p_currency text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone';
  end if;
  if p_currency is null or p_currency not in ('PLN','EUR','USD','GBP','CZK') then
    raise exception 'invalid currency';
  end if;
  select o.handle into v_old from public.orgs o where o.id = p_org_id for update;
  -- A handle another org once used is theirs for good. Surfaced as 23505 so
  -- the callers' "just taken" mapping covers it.
  if p_handle is not null and exists (
    select 1 from public.org_handle_history h where h.handle = p_handle and h.org_id <> p_org_id
  ) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone, currency = p_currency
    where id = p_org_id;
  if v_old is not null and v_old is distinct from p_handle then
    insert into public.org_handle_history (handle, org_id) values (v_old, p_org_id)
    on conflict (handle) do update set org_id = excluded.org_id, released_at = now();
  end if;
  -- Taking one of its own old handles back retires the history row.
  if p_handle is not null then
    delete from public.org_handle_history h where h.handle = p_handle and h.org_id = p_org_id;
  end if;
end;
$$;
revoke all on function public.update_org_scheduling(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text, text) to authenticated;

-- =====================================================================
-- Part B: the booking-write RPCs snapshot money onto the row, the public
-- create paths stamp terms_accepted_at, reschedule recomputes at the LIVE
-- offering price while carrying terms forward, cancel_booking gates a
-- self-cancel inside the offering's free-cancellation window, and the
-- resolver exposes the same money columns. Each function below is copied
-- verbatim from its latest body (named in the plan) with only the listed
-- deltas applied — `create or replace` throughout (no signature changes
-- except resolve_booking_token's return type, handled with drop+create).
-- =====================================================================

-- ---------- create_rental_booking (base: 0054). + o.currency, the money
-- snapshot computed right after the stay length is known, and the four new
-- insert columns (terms_accepted_at stamped iff the offering has terms).
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
begin
  select o.id, o.timezone, o.currency, o.offers_rentals into v_org
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
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     v_starts, v_ends, 'confirmed', p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text) to service_role;

-- ---------- create_rental_booking_admin (base: 0039). + o.currency (as
-- org_currency, v_off already selects ro.* so the money helpers read the
-- offering's own columns off it), the money snapshot, and the four insert
-- columns — terms_accepted_at is explicitly null (walk-ins never accept
-- terms; written out loud rather than omitted so the intent is reviewable).
create or replace function public.create_rental_booking_admin(
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
  v_off record;
  v_tz text;
  v_len int;
  v_night_adj int;
  v_occ_start date;
  v_occ_end date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_unit uuid;
  v_client_id uuid;
  v_booking_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
begin
  select ro.*, o.timezone as org_tz, o.currency as org_currency into v_off
    from public.rental_offerings ro
    join public.orgs o on o.id = ro.org_id
    where ro.id = p_offering_id
      and ro.org_id in (select public.user_orgs())
      and ro.active;
  if v_off.id is null then raise exception 'not found'; end if;
  v_tz := v_off.org_tz;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'not found'; end if;

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
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_off.org_currency end;

  v_starts := (p_start_date::text || ' ' || v_off.start_time)::timestamp at time zone v_tz;
  v_ends := (p_end_date::text || ' ' || v_off.end_time)::timestamp at time zone v_tz;
  if v_ends <= v_starts or v_starts <= now() then raise exception 'not found'; end if;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  select u.id into v_unit
    from public.rental_units u
    where u.offering_id = v_off.id and u.active
      and (p_unit_id is null or u.id = p_unit_id)
      and public.rental_unit_is_free(u.id, v_tz, v_off.range_mode,
                                     v_occ_start, v_occ_end, v_off.turnover_days, null)
    order by u.sort_order, u.created_at
    limit 1;
  if v_unit is null then raise exception 'taken'; end if;

  if p_email is not null then
    insert into public.clients (org_id, name, email)
    values (v_off.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null
    do update set name = clients.name
    returning id into v_client_id;
  end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_off.org_id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     v_starts, v_ends, 'confirmed', p_token_hash, p_note, v_total, v_snap_currency, v_deposit, null)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_rental_booking_admin(uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_admin(uuid, uuid, date, date, text, text, text, text)
  to authenticated;

-- ---------- create_rental_booking_hours (base: 0056). + o.currency, the
-- duration-based money snapshot, and the four insert columns (terms
-- stamped iff the offering has terms — the public path).
create or replace function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
begin
  select o.id, o.timezone, o.currency, o.offers_rentals into v_org
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
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, p_duration_min / 60.0);
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
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text) to service_role;

-- ---------- create_rental_booking_hours_admin (base: 0056). + o.currency
-- (as org_currency), the duration-based money snapshot, and the four
-- insert columns — terms_accepted_at explicitly null (walk-ins).
create or replace function public.create_rental_booking_hours_admin(
  p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_off record; v_tz text; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid;
  v_total int; v_deposit int; v_snap_currency text;
begin
  select ro.*, o.timezone as org_tz, o.currency as org_currency into v_off
    from public.rental_offerings ro
    join public.orgs o on o.id = ro.org_id
    where ro.id = p_offering_id
      and ro.org_id in (select public.user_orgs())
      and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;
  v_tz := v_off.org_tz;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, p_duration_min / 60.0);
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_off.org_currency end;
  if p_starts_at <= now() then raise exception 'not found'; end if;
  if not public.slot_within_offering_availability(v_off.id, v_tz, p_starts_at, v_ends) then
    raise exception 'not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  select u.id into v_unit
    from public.rental_units u
    where u.offering_id = v_off.id and u.active
      and (p_unit_id is null or u.id = p_unit_id)
      and public.rental_unit_is_free_hours(u.id, v_tz, p_starts_at, v_ends, v_off.turnover_min, null)
    order by u.sort_order, u.created_at
    limit 1;
  if v_unit is null then raise exception 'taken'; end if;

  if p_email is not null then
    insert into public.clients (org_id, name, email)
    values (v_off.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null
    do update set name = clients.name
    returning id into v_client_id;
  end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_off.org_id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note, v_total, v_snap_currency, v_deposit, null)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text) to authenticated;

-- ---------- reschedule_rental_apply (base: 0039). + b.terms_accepted_at on
-- v_old, o.currency on v_org, the recomputed-at-live-price money snapshot,
-- and the four new-row insert columns (terms carried from the old row —
-- a reschedule never re-asks for consent).
create or replace function public.reschedule_rental_apply(
  p_old_id uuid,
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_new_token_hash text,
  p_enforce_limits boolean
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  old_ends_at timestamptz,
  new_starts_at timestamptz,
  new_ends_at timestamptz,
  unit_changed boolean,
  dates_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
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
  v_new_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at
    into v_old
    from public.bookings b
    where b.id = p_old_id
    for update;
  if v_old.id is null or v_old.rental_offering_id is null or v_old.status <> 'confirmed' then
    raise exception 'not found';
  end if;
  -- R2 rule: a stay that has begun cannot be moved (the client is in the
  -- unit). Distinct message so the callers can say so.
  if v_old.starts_at <= now() then raise exception 'started'; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'not found'; end if;

  select o.id, o.name, o.timezone, o.currency into v_org from public.orgs o where o.id = v_old.org_id;
  select * into v_off from public.rental_offerings ro
    where ro.id = v_old.rental_offering_id and ro.active;
  if v_off.id is null then raise exception 'not found'; end if;

  v_today := (now() at time zone v_org.timezone)::date;
  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_start_date < v_today + v_off.min_notice_days then raise exception 'not found'; end if;
    if p_end_date > v_today + v_off.booking_window_days then raise exception 'not found'; end if;
  end if;

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
  if v_ends <= v_starts or v_starts <= now() then raise exception 'not found'; end if;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  -- Free the old row first so a shift shorter than the stay can't
  -- self-conflict. Any raise below rolls this back with everything else.
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  -- Unit: explicit → must be free; auto → keep the old unit if free, else
  -- the first free one in display order.
  if p_unit_id is not null then
    select u.id into v_unit
      from public.rental_units u
      where u.id = p_unit_id and u.offering_id = v_off.id and u.active
        and public.rental_unit_is_free(u.id, v_org.timezone, v_off.range_mode,
                                       v_occ_start, v_occ_end, v_off.turnover_days, v_old.id);
  else
    select u.id into v_unit
      from public.rental_units u
      where u.offering_id = v_off.id and u.active
        and public.rental_unit_is_free(u.id, v_org.timezone, v_off.range_mode,
                                       v_occ_start, v_occ_end, v_off.turnover_days, v_old.id)
      order by (u.id = v_old.rental_unit_id) desc, u.sort_order, u.created_at
      limit 1;
  end if;
  if v_unit is null then raise exception 'taken'; end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     v_starts, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at)
  returning id into v_new_id;

  return query
    select v_new_id, v_old.org_id, v_org.name, v_org.timezone,
           v_off.name || ' · ' || u.name, v_old.client_name, v_old.client_email,
           v_old.starts_at, v_old.ends_at, v_starts, v_ends,
           (v_unit <> v_old.rental_unit_id),
           (v_starts <> v_old.starts_at or v_ends <> v_old.ends_at)
    from public.rental_units u
    where u.id = v_unit;
end;
$$;

revoke all on function public.reschedule_rental_apply(uuid, uuid, date, date, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------- reschedule_rental_hours_apply (base: 0056). Same deltas as
-- reschedule_rental_apply above, total computed from v_duration / 60.0.
create or replace function public.reschedule_rental_hours_apply(
  p_old_id uuid,
  p_unit_id uuid,
  p_starts_at timestamptz,
  p_new_token_hash text,
  p_enforce_limits boolean
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  old_ends_at timestamptz,
  new_starts_at timestamptz,
  new_ends_at timestamptz,
  unit_changed boolean,
  dates_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_org record;
  v_off record;
  v_duration int;
  v_ends timestamptz;
  v_unit uuid;
  v_new_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at
    into v_old
    from public.bookings b
    where b.id = p_old_id
    for update;
  if v_old.id is null or v_old.rental_offering_id is null or v_old.status <> 'confirmed' then
    raise exception 'not found';
  end if;
  -- Same rule as R2: a stay that has begun cannot be moved.
  if v_old.starts_at <= now() then raise exception 'started'; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_starts_at is null then raise exception 'not found'; end if;

  select o.id, o.name, o.timezone, o.currency into v_org from public.orgs o where o.id = v_old.org_id;
  select * into v_off from public.rental_offerings ro
    where ro.id = v_old.rental_offering_id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;

  -- Duration is not renegotiated on reschedule — it is copied from the old
  -- row (the offering's grid was already validated when it was created).
  v_duration := extract(epoch from (v_old.ends_at - v_old.starts_at))::int / 60;
  v_ends := p_starts_at + make_interval(mins => v_duration);
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_duration / 60.0);
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;

  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_starts_at <= now() + make_interval(mins => v_off.min_notice_min) then raise exception 'not found'; end if;
    if p_starts_at > now() + make_interval(days => v_off.booking_window_days + 1) then raise exception 'not found'; end if;
  end if;

  -- Unconditional, like the nights/days v_starts <= now() guard: even the
  -- provider cannot reschedule a booking into the past.
  if p_starts_at <= now() then raise exception 'not found'; end if;

  if not public.slot_within_offering_availability(v_off.id, v_org.timezone, p_starts_at, v_ends) then
    raise exception 'not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  -- Free the old row first so a shift shorter than the stay can't
  -- self-conflict. Any raise below rolls this back with everything else.
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  -- Unit: explicit → must be free; auto → keep the old unit if free, else
  -- the first free one in display order.
  if p_unit_id is not null then
    select u.id into v_unit
      from public.rental_units u
      where u.id = p_unit_id and u.offering_id = v_off.id and u.active
        and public.rental_unit_is_free_hours(u.id, v_org.timezone, p_starts_at, v_ends,
                                             v_off.turnover_min, v_old.id);
  else
    select u.id into v_unit
      from public.rental_units u
      where u.offering_id = v_off.id and u.active
        and public.rental_unit_is_free_hours(u.id, v_org.timezone, p_starts_at, v_ends,
                                             v_off.turnover_min, v_old.id)
      order by (u.id = v_old.rental_unit_id) desc, u.sort_order, u.created_at
      limit 1;
  end if;
  if v_unit is null then raise exception 'taken'; end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at)
  returning id into v_new_id;

  return query
    select v_new_id, v_old.org_id, v_org.name, v_org.timezone,
           v_off.name || ' · ' || u.name, v_old.client_name, v_old.client_email,
           v_old.starts_at, v_old.ends_at, p_starts_at, v_ends,
           (v_unit <> v_old.rental_unit_id),
           (p_starts_at <> v_old.starts_at or v_ends <> v_old.ends_at)
    from public.rental_units u
    where u.id = v_unit;
end;
$$;
revoke all on function public.reschedule_rental_hours_apply(uuid, uuid, timestamptz, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------- cancel_booking: full replacement (same signature/returns). A
-- rental inside its offering's free-cancellation window cannot self-cancel;
-- the distinction from a dead token is surfaced as the 'cancel_window'
-- sentinel (single lowercase word, matching 'taken'/'started').
-- Appointments (rental_offering_id null) are unaffected.
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
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
      -- H3: a rental inside its free-cancellation window cannot self-cancel.
      and (b.rental_offering_id is null or not exists (
        select 1 from public.rental_offerings ro
        where ro.id = b.rental_offering_id
          and ro.cancel_window_min > 0
          and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)))
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
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, ro.name || ' · ' || u.name),
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

-- ---------- resolve_booking_token: return type changes (+ four money
-- columns appended after staff_name — PostgREST/TS callers select columns
-- by name, so appending is safe; order stays stable for sanity).
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min
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

-- Two function signatures/return types changed (cancel_booking replaced
-- in place, resolve_booking_token dropped+recreated); PostgREST must
-- re-read its schema cache.
notify pgrst, 'reload schema';
