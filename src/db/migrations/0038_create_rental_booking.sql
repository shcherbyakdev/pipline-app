-- 0038 (Rentals R1): the anon write path for rentals. Mirrors create_booking
-- (0034): definer, uniform 'not found' on bad input, per-org throttle,
-- client upsert keeps the existing name. Adds: date-range validation in the
-- org zone, unit auto-assignment with turnover + blackout awareness, and a
-- per-offering advisory lock so a turnover-only conflict (which the EXCLUDE
-- guard cannot see) can't slip through a race.
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
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;

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
  if v_ends <= v_starts or v_ends <= now() then raise exception 'not found'; end if;

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
      and not exists (
        select 1 from public.rental_unit_blackouts bl
        where bl.rental_unit_id = u.id
          and daterange(bl.start_date, bl.end_date, '[]')
              && daterange(v_occ_start, v_occ_end + v_off.turnover_days, '[]'))
      and not exists (
        select 1 from public.bookings b
        where b.rental_unit_id = u.id and b.status = 'confirmed'
          -- greatest(): the planner may evaluate this daterange before the
          -- rental_unit_id filter, and a same-day appointment row would then
          -- build an inverted range (lower > upper) and abort the whole call.
          -- Clamping keeps the expression total; real rental rows are never
          -- clamped (occupancy always ends on or after check-in).
          and daterange((b.starts_at at time zone v_org.timezone)::date,
                        greatest((b.starts_at at time zone v_org.timezone)::date,
                                 (b.ends_at at time zone v_org.timezone)::date - v_night_adj + v_off.turnover_days), '[]')
              && daterange(v_occ_start, v_occ_end + v_off.turnover_days, '[]'))
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
grant execute on function public.create_rental_booking(text, uuid, uuid, date, date, text, text, text, text)
  to anon;
