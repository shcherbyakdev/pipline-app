-- H1 org modes: what an org sells (appointments / rentals / both).
--   * Backfill from existing data BEFORE the CHECK:
--       offers_rentals      = has any rental_offerings row
--       offers_appointments = has any services row, OR has no rentals
--     (never-configured orgs land in appointments-only — today's default flow)
--   * orgs stays select-only for authenticated (0004): the flags are written
--     only via create_org / create_org_with_page (extended) and
--     update_org_modes (new).
--   * Public create RPCs answer the uniform 'not found' when their channel is
--     off (no channel-existence oracle). Admin RPCs are NOT gated — an owner
--     may still hand-book a hidden channel from the timeline / calendar.

-- One-shot backfill: do NOT re-apply this file once orgs may have changed modes in Settings — it would overwrite their choice from data.
update public.orgs o set
  offers_rentals = exists (select 1 from public.rental_offerings r where r.org_id = o.id),
  offers_appointments =
       exists (select 1 from public.services s where s.org_id = o.id)
    or not exists (select 1 from public.rental_offerings r where r.org_id = o.id);

alter table public.orgs
  drop constraint if exists orgs_offers_something,
  add constraint orgs_offers_something check (offers_appointments or offers_rentals);

-- ---------- create_org (0052 body) + p_offers_appointments / p_offers_rentals.
drop function if exists public.create_org(text);
create or replace function public.create_org(
  p_name text,
  p_offers_appointments boolean default true,
  p_offers_rentals boolean default true
)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
  v_slug text;
  v_staff_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.org_members m where m.user_id = auth.uid()) then
    raise exception 'already onboarded';
  end if;
  if not (coalesce(p_offers_appointments, false) or coalesce(p_offers_rentals, false)) then
    raise exception 'pick at least one booking type';
  end if;
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_staff_slug := trim(both '-' from left(v_slug, 40));
  if length(v_staff_slug) < 2 then v_staff_slug := v_staff_slug || '-1'; end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.orgs (name, slug, offers_appointments, offers_rentals)
    values (trim(p_name), v_slug, p_offers_appointments, p_offers_rentals)
    returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  -- staff.name is capped at 80; orgs.name is not, so clamp rather than fail.
  insert into public.staff (org_id, name, slug, color, sort_order)
    values (v_org.id, left(trim(p_name), 80), v_staff_slug, '#4f46e5', 0);
  return v_org;
end; $$;
revoke all on function public.create_org(text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org(text, boolean, boolean) to authenticated;

-- ---------- create_org_with_page (0052 body) + the same two params, passed
-- straight through to create_org (the at-least-one check lives there).
drop function if exists public.create_org_with_page(text, text, text);
create or replace function public.create_org_with_page(
  p_name text,
  p_handle text,
  p_timezone text,
  p_offers_appointments boolean default true,
  p_offers_rentals boolean default true
)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
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
  if p_handle is not null and exists (select 1 from public.org_handle_history h where h.handle = p_handle) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  v_org := public.create_org(p_name, p_offers_appointments, p_offers_rentals);
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text, boolean, boolean) to authenticated;

-- ---------- update_org_modes (mirrors update_org_scheduling, 0026 idiom).
create or replace function public.update_org_modes(
  p_org_id uuid,
  p_offers_appointments boolean,
  p_offers_rentals boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'org not found';
  end if;
  if not (coalesce(p_offers_appointments, false) or coalesce(p_offers_rentals, false)) then
    raise exception 'pick at least one booking type';
  end if;

  update public.orgs
     set offers_appointments = p_offers_appointments,
         offers_rentals = p_offers_rentals
   where id = p_org_id;
end;
$$;

revoke all on function public.update_org_modes(uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_modes(uuid, boolean, boolean) to authenticated;

-- ---------- Gated public create RPCs.
-- Re-created from 0052 / 0039 with the H1 channel gate; body otherwise unchanged.
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid[]);
create function public.create_booking(
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
  select s.id, s.duration_min, s.booking_window_days into v_service
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
         p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
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

-- Re-created from 0052 / 0039 with the H1 channel gate; body otherwise unchanged.
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
begin
  select o.id, o.timezone, o.offers_rentals into v_org
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
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     v_starts, v_ends, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text) to service_role;
