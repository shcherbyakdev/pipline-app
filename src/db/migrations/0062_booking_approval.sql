ALTER TABLE "bookings" ADD COLUMN "decline_note" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_offerings" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- ============================================================
-- Booking approval (request-to-book). A 'pending' booking is a request:
-- it HOLDS its slot (EXCLUDE below), 'declined' frees it by status flip,
-- and a pending row past its starts_at is expired by definition — no cron.
-- ============================================================

alter table public.bookings
  add constraint bookings_decline_note_check
    check (decline_note is null or length(decline_note) <= 500);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_status_check;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','pending','declined',
       'cancelled_by_client','cancelled_by_provider','rescheduled'));
--> statement-breakpoint
-- Both overlap guards (0041 staff-scoped, 0037 unit-scoped) re-created so a
-- pending request reserves the slot. Accepting (pending -> confirmed) can
-- never conflict; declining/cancelling frees the slot with no further work.
alter table public.bookings drop constraint bookings_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending') and staff_id is not null);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_rental_unit_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_rental_unit_no_overlap
  exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending') and rental_unit_id is not null);
--> statement-breakpoint

-- ---------- Free-check helpers, re-created from their latest bodies (0041,
-- 0052, 0039, 0056) with the single status predicate widened.
-- Free-checks mirror the EXCLUDE predicate — a slot a pending request holds
-- must read as busy, or the constraint 23P01s what the pre-check allowed.

-- staff_is_free (base: 0041). pick_staff_for_slot's actual freedom test
-- (its own widened predicate below is only the least-loaded ranking), and
-- its only caller — so "pick_staff_for_slot covers pending" means this one
-- has to move too, or auto-assign keeps offering staff a request already
-- holds and lets the EXCLUDE reject the insert it just authorized.
create or replace function public.staff_is_free(
  p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.staff_id = p_staff_id and b.status in ('confirmed','pending')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at));
$$;
revoke all on function public.staff_is_free(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- pick_staff_for_slot (base: 0052).
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
      where b.staff_id = st.id and b.status in ('confirmed','pending')
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[], uuid[])
  from public, anon, authenticated, service_role;

-- rental_unit_is_free (base: 0039).
create or replace function public.rental_unit_is_free(
  p_unit_id uuid,
  p_timezone text,
  p_range_mode text,
  p_occ_start date,
  p_occ_end date,
  p_turnover int,
  p_exclude_booking_id uuid
) returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status in ('confirmed','pending')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        -- greatest(): keep the range total even if the planner evaluates it
        -- before the unit filter (see 0038).
        and daterange((b.starts_at at time zone p_timezone)::date,
                      greatest((b.starts_at at time zone p_timezone)::date,
                               (b.ends_at at time zone p_timezone)::date
                                 - case when p_range_mode = 'nights' then 1 else 0 end
                                 + p_turnover), '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'));
$$;

revoke all on function public.rental_unit_is_free(uuid, text, text, date, date, int, uuid)
  from public, anon, authenticated, service_role;

-- rental_unit_is_free_hours (base: 0056).
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
        and b.status in ('confirmed','pending')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and tstzrange(b.starts_at, b.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;

-- ---------- Public create RPCs read the flag. Each is its latest body
-- (create_booking: 0054; the rental pair: 0058) with only the flag read and
-- the inserted status literal changed. The _admin siblings are untouched —
-- a walk-in the provider books is already their own decision.

-- create_booking (base: 0054).
create or replace function public.create_booking(
  p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_note text, p_token_hash text, p_staff_id uuid default null, p_candidates uuid[] default null
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
begin
  select o.id, o.timezone, o.offers_appointments into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_appointments then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days, s.requires_approval into v_service
    from public.services s where s.id = p_service_id and s.org_id = v_org.id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  -- One address, one org, five rows an hour (any status — reschedules
  -- create rows too). Bounds the confirmation-mail and calendar-fill loops
  -- a single address could otherwise drive; a distinct sentinel so the
  -- action can say so instead of "try again".
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and lower(b.client_email) = lower(p_email)
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

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  loop
    if p_staff_id is null then
      v_staff := public.pick_staff_for_slot(p_service_id, v_org.timezone, p_starts_at, v_ends_at, v_tried, p_candidates);
      if v_staff is null then raise exception 'taken'; end if;
    end if;
    begin
      insert into public.bookings
        (org_id, service_id, staff_id, client_id, client_name, client_email,
         starts_at, ends_at, status, cancel_token_hash, note)
      values
        (v_org.id, p_service_id, v_staff, v_client_id, btrim(p_name), lower(p_email),
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
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[]) to service_role;

-- create_rental_booking (base: 0058). v_off is `select *`, so
-- v_off.requires_approval is already in scope.
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
     v_starts, v_ends,
     case when v_off.requires_approval then 'pending' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text) to service_role;

-- create_rental_booking_hours (base: 0058).
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
     p_starts_at, v_ends,
     case when v_off.requires_approval then 'pending' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text) to service_role;

-- ---------- cancel_booking (base: 0058): a pending request is a withdrawal,
-- not a cancellation, and is therefore always allowed while it is still in
-- the future. The H3 free-cancellation window guards CONFIRMED rentals only
-- (nothing has been promised yet on a request), so its sentinel `exists`
-- check below keeps its own `status = 'confirmed'` unchanged.
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
      and (b.status = 'pending'
        -- H3: a CONFIRMED rental inside its free-cancellation window cannot
        -- self-cancel; a pending request is always withdrawable.
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
