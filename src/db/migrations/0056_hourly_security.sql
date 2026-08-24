-- 0056: hourly mode security surface (H2). Idiom: 0037/0038/0041.
-- Appended across plan Tasks 2 and 3 (0041 precedent).

-- ---------- rental_offerings: mode + per-mode field CHECKs
alter table public.rental_offerings drop constraint rental_offerings_range_mode;
alter table public.rental_offerings
  add constraint rental_offerings_range_mode check (range_mode in ('nights', 'days', 'hours'));

-- Duration trio present iff hours; multiples of the increment; max >= min.
alter table public.rental_offerings add constraint rental_offerings_hours_fields check (
  case when range_mode = 'hours' then
    slot_increment_min is not null and min_duration_min is not null and max_duration_min is not null
    and slot_increment_min between 5 and 240
    and min_duration_min between 5 and 1440
    and max_duration_min between min_duration_min and 1440
    and min_duration_min % slot_increment_min = 0
    and max_duration_min % slot_increment_min = 0
    and turnover_min between 0 and 1440
    and min_notice_min between 0 and 43200
  else
    slot_increment_min is null and min_duration_min is null and max_duration_min is null
  end
);

-- Check-in/out times belong to nights/days only; hours reads opening hours
-- from availability_rules. (0037's *_fmt CHECKs allow NULL already — verify:
-- they are `check (start_time ~ ...)`, which is NULL-passing in SQL.)
-- nights/days keep the pre-0055 column-level NOT NULL as a same-shape CHECK:
-- both times must be set (not just "not both null" — an equality on the two
-- booleans would accept exactly-one-set, which is not a valid window).
alter table public.rental_offerings add constraint rental_offerings_times_by_mode check (
  case when range_mode = 'hours'
       then start_time is null and end_time is null
       else start_time is not null and end_time is not null
  end
);

-- ---------- availability owner: staff XOR rental offering (bookings_kind idiom)
alter table public.availability_rules alter column staff_id drop not null;
alter table public.availability_exceptions alter column staff_id drop not null;
alter table public.availability_rules add constraint availability_rules_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));
alter table public.availability_exceptions add constraint availability_exceptions_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));

-- ---------- EXCLUDE twins: the 0041 staff-keyed guards never fire when
-- staff_id is NULL, so offering rows need their own (same hm_to_min shape).
alter table public.availability_rules add constraint availability_rules_offering_no_overlap
  exclude using gist (rental_offering_id with =, weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (rental_offering_id is not null);
alter table public.availability_exceptions add constraint availability_exceptions_offering_no_overlap
  exclude using gist (rental_offering_id with =, date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (not closed and rental_offering_id is not null);

-- ---------- org-consistency trigger (check_staff_owner_org idiom)
create or replace function public.check_offering_owner_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  if new.rental_offering_id is null then return new; end if;
  select org_id into v_org from public.rental_offerings where id = new.rental_offering_id;
  if v_org is null then raise exception 'offering not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
create trigger availability_rules_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_rules
  for each row execute function public.check_offering_owner_org();
create trigger availability_exceptions_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_exceptions
  for each row execute function public.check_offering_owner_org();

-- =====================================================================
-- Part B: helpers + the five hourly RPCs (0039/0054 idiom, duration-based
-- occupancy instead of date ranges).
-- =====================================================================

-- ---------- slot_within_offering_availability: 0041's slot_within_availability
-- with the owner swapped to rental_offering_id. Same one-org-local-day rule.
create function public.slot_within_offering_availability(
  p_offering_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz
) returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_start_local timestamp := p_starts_at at time zone p_timezone;
  v_end_local   timestamp := p_ends_at   at time zone p_timezone;
  v_date date := v_start_local::date;
  v_start_hm text := to_char(v_start_local, 'HH24:MI');
  v_end_hm   text := to_char(v_end_local,   'HH24:MI');
  v_weekday int := extract(dow from v_start_local)::int;
begin
  if v_end_local::date <> v_date then return false; end if;
  if exists (select 1 from public.availability_exceptions ae
             where ae.rental_offering_id = p_offering_id and ae.date = v_date) then
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.rental_offering_id = p_offering_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm);
  end if;
  return exists (
    select 1 from public.availability_rules ar
    where ar.rental_offering_id = p_offering_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm);
end; $$;
revoke all on function public.slot_within_offering_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- rental_unit_is_free_hours: tstzrange sibling of
-- rental_unit_is_free. Both sides share the offering's turnover, so a single
-- range extended by the turnover on each side's END is exactly the engine's
-- two-sided check (bufferBefore is always 0 for hourly).
create function public.rental_unit_is_free_hours(
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
        and b.status = 'confirmed'
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and tstzrange(b.starts_at, b.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;

-- ---------- shared hourly validation is inlined in each RPC (plpgsql has no
-- cheap record-passing; the R2 create/admin pair does the same).

create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
begin
  select o.id, o.timezone, o.offers_rentals into v_org
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
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text) to service_role;

-- ---------- create_rental_booking_hours_admin: R2 admin deltas
-- (create_rental_booking_admin, 0039) applied to the hours body above —
-- org-membership resolve, ro.active still required (R2 semantics), email
-- optional, no throttles/notice/window, occupancy still enforced.
create function public.create_rental_booking_hours_admin(
  p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_off record; v_tz text; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid;
begin
  select ro.*, o.timezone as org_tz into v_off
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
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_off.org_id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text) to authenticated;

-- ---------- reschedule_rental_hours_apply: reschedule_rental_apply (0039)
-- mirrored with duration copied from the old row instead of new dates.
create function public.reschedule_rental_hours_apply(
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
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status
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

  select o.id, o.name, o.timezone into v_org from public.orgs o where o.id = v_old.org_id;
  select * into v_off from public.rental_offerings ro
    where ro.id = v_old.rental_offering_id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;

  -- Duration is not renegotiated on reschedule — it is copied from the old
  -- row (the offering's grid was already validated when it was created).
  v_duration := extract(epoch from (v_old.ends_at - v_old.starts_at))::int / 60;
  v_ends := p_starts_at + make_interval(mins => v_duration);

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
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id)
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

-- ---------- reschedule_rental_booking_hours: client (token-scoped) wrapper,
-- reschedule_rental_booking (0039) verbatim except the delegate call and its
-- own args. 0052 posture: service_role only, not anon — the app action is
-- the entry point, same as create_rental_booking_hours above.
create function public.reschedule_rental_booking_hours(
  p_token text,
  p_unit_id uuid,
  p_starts_at timestamptz,
  p_new_token_hash text
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
  v_hash text;
  v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select b.id into v_id from public.bookings b
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.rental_unit_id is not null;
  if v_id is null then return; end if;
  return query select * from public.reschedule_rental_hours_apply(
    v_id, p_unit_id, p_starts_at, p_new_token_hash, true);
end;
$$;
revoke all on function public.reschedule_rental_booking_hours(text, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_rental_booking_hours(text, uuid, timestamptz, text) to service_role;

-- ---------- reschedule_rental_booking_hours_admin: admin (authenticated,
-- member-scoped) wrapper, reschedule_rental_booking_admin (0039) verbatim
-- except the delegate call and its own args.
create function public.reschedule_rental_booking_hours_admin(
  p_booking_id uuid,
  p_unit_id uuid,
  p_starts_at timestamptz,
  p_new_token_hash text
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
  v_id uuid;
begin
  select b.id into v_id from public.bookings b
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.rental_unit_id is not null;
  if v_id is null then raise exception 'not found'; end if;
  return query select * from public.reschedule_rental_hours_apply(
    v_id, p_unit_id, p_starts_at, p_new_token_hash, false);
end;
$$;
revoke all on function public.reschedule_rental_booking_hours_admin(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_rental_booking_hours_admin(uuid, uuid, timestamptz, text) to authenticated;
