-- 0041 (Team): staff becomes the calendar owner. Backfill one staff per org,
-- re-key availability + appointment bookings + all EXCLUDE guards to
-- staff_id, RLS/grants for the two new tables, org-consistency + offboarding
-- triggers, create_org seeds the first staff, create_staff copies a schedule.
-- RPC changes for booking/reschedule live in 0041 too (below, Task 3/4).
--
-- Written idempotently (drop-if-exists before every add) so later tasks can
-- append to this same file and the whole thing can be re-applied by hand.

-- ---------- CHECKs
alter table public.staff drop constraint if exists staff_name_len;
alter table public.staff add constraint staff_name_len check (length(name) between 1 and 80);
alter table public.staff drop constraint if exists staff_slug_format;
alter table public.staff add constraint staff_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or slug ~ '^[a-z0-9]{2}$');
alter table public.staff drop constraint if exists staff_color_hex;
alter table public.staff add constraint staff_color_hex check (color ~ '^#[0-9a-f]{6}$');
alter table public.staff drop constraint if exists staff_email_lower;
alter table public.staff add constraint staff_email_lower check (email is null or (email = lower(email) and length(email) <= 320));

-- ---------- Backfill: one staff per org, everything re-pointed.
-- The slug is padded inline: orgs.name has no length floor, so a one-char
-- name would otherwise produce a slug the CHECK above rejects.
insert into public.staff (org_id, name, slug, color, sort_order)
select o.id,
       left(o.name, 80),
       case when length(b.base) < 2 then b.base || '-1' else b.base end,
       '#4f46e5', 0
from public.orgs o
cross join lateral (
  select coalesce(
    nullif(trim(both '-' from left(trim(both '-' from regexp_replace(lower(o.name), '[^a-z0-9]+', '-', 'g')), 40)), ''),
    'team-member') as base
) b
where not exists (select 1 from public.staff s where s.org_id = o.id);
-- Slugs shorter than 2 chars violate the CHECK; pad them.
update public.staff set slug = slug || '-1' where length(slug) < 2;

update public.availability_rules r set staff_id = s.id
  from public.staff s where s.org_id = r.org_id and r.staff_id is null;
update public.availability_exceptions e set staff_id = s.id
  from public.staff s where s.org_id = e.org_id and e.staff_id is null;
update public.bookings b set staff_id = s.id
  from public.staff s where s.org_id = b.org_id and b.staff_id is null and b.service_id is not null;
-- Only fan out inside orgs that are still solo. Unscoped, a re-run of this
-- file (Tasks 3/4 append to it) would re-assign every service to every staff
-- and silently undo deliberate per-staff service selections.
insert into public.service_staff (org_id, service_id, staff_id)
select sv.org_id, sv.id, st.id from public.services sv join public.staff st on st.org_id = sv.org_id
where (select count(*) from public.staff s2 where s2.org_id = sv.org_id) = 1
on conflict do nothing;

alter table public.availability_rules alter column staff_id set not null;
alter table public.availability_exceptions alter column staff_id set not null;
alter table public.bookings drop constraint if exists bookings_staff_iff_service;
alter table public.bookings add constraint bookings_staff_iff_service
  check ((service_id is null) = (staff_id is null));

-- ---------- Guards re-keyed to staff (0026/0035/0037 shapes, org_id → staff_id)
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed' and staff_id is not null);
alter table public.availability_rules drop constraint if exists availability_rules_no_overlap;
alter table public.availability_rules add constraint availability_rules_no_overlap
  exclude using gist (staff_id with =, weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&);
alter table public.availability_exceptions drop constraint if exists availability_exceptions_no_overlap;
alter table public.availability_exceptions add constraint availability_exceptions_no_overlap
  exclude using gist (staff_id with =, date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (not closed);

-- ---------- RLS + grants (0026 doctrine)
alter table public.staff enable row level security;
alter table public.service_staff enable row level security;
drop policy if exists "staff_select_member" on public.staff;
create policy "staff_select_member" on public.staff
  for select to authenticated using (org_id in (select public.user_orgs()));
drop policy if exists "staff_insert_member" on public.staff;
create policy "staff_insert_member" on public.staff
  for insert to authenticated with check (org_id in (select public.user_orgs()));
drop policy if exists "staff_update_member" on public.staff;
create policy "staff_update_member" on public.staff
  for update to authenticated
  using (org_id in (select public.user_orgs())) with check (org_id in (select public.user_orgs()));
-- no delete policy: staff rows are history (deactivate instead)
drop policy if exists "service_staff_select_member" on public.service_staff;
create policy "service_staff_select_member" on public.service_staff
  for select to authenticated using (org_id in (select public.user_orgs()));
drop policy if exists "service_staff_insert_member" on public.service_staff;
create policy "service_staff_insert_member" on public.service_staff
  for insert to authenticated with check (org_id in (select public.user_orgs()));
drop policy if exists "service_staff_delete_member" on public.service_staff;
create policy "service_staff_delete_member" on public.service_staff
  for delete to authenticated using (org_id in (select public.user_orgs()));

revoke all on table public.staff from public, anon, authenticated, service_role;
grant select, insert, update on table public.staff to authenticated;
grant select, insert, update on table public.staff to service_role;
revoke all on table public.service_staff from public, anon, authenticated, service_role;
grant select, insert, delete on table public.service_staff to authenticated;
grant select, insert, delete on table public.service_staff to service_role;

-- ---------- Org-consistency triggers (check_booking_org idiom)
create or replace function public.check_staff_owner_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  -- Null falls through to the NOT NULL constraint (23502) — keeps the
  -- error code meaningful instead of a trigger raise.
  if new.staff_id is null then return new; end if;
  select org_id into v_org from public.staff where id = new.staff_id;
  if v_org is null then raise exception 'staff not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
drop trigger if exists availability_rules_staff_guard on public.availability_rules;
create trigger availability_rules_staff_guard
  before insert or update of org_id, staff_id on public.availability_rules
  for each row execute function public.check_staff_owner_org();
drop trigger if exists availability_exceptions_staff_guard on public.availability_exceptions;
create trigger availability_exceptions_staff_guard
  before insert or update of org_id, staff_id on public.availability_exceptions
  for each row execute function public.check_staff_owner_org();

create or replace function public.check_service_staff_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.services where id = new.service_id;
  if v_org is null or v_org <> new.org_id then raise exception 'org mismatch'; end if;
  select org_id into v_org from public.staff where id = new.staff_id;
  if v_org is null or v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
drop trigger if exists service_staff_org_guard on public.service_staff;
create trigger service_staff_org_guard
  before insert or update on public.service_staff
  for each row execute function public.check_service_staff_org();

-- bookings: extend 0037's check_booking_org with the staff check.
create or replace function public.check_booking_org()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_org uuid;
  v_offering uuid;
begin
  if new.service_id is not null then
    select org_id into v_org from public.services where id = new.service_id;
    if v_org is null then raise exception 'service not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.staff_id is not null then
    select org_id into v_org from public.staff where id = new.staff_id;
    if v_org is null then raise exception 'staff not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.rental_offering_id is not null then
    select org_id into v_org from public.rental_offerings where id = new.rental_offering_id;
    if v_org is null then raise exception 'offering not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
    select org_id, offering_id into v_org, v_offering from public.rental_units where id = new.rental_unit_id;
    if v_org is null then raise exception 'unit not found'; end if;
    if v_org <> new.org_id or v_offering <> new.rental_offering_id then raise exception 'org mismatch'; end if;
  end if;
  if new.client_id is not null then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.rescheduled_from_id is not null then
    select org_id into v_org from public.bookings where id = new.rescheduled_from_id;
    if v_org is null then raise exception 'booking not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists bookings_org_guard on public.bookings;
create trigger bookings_org_guard
  before insert or update of org_id, service_id, staff_id, client_id, rescheduled_from_id,
    rental_offering_id, rental_unit_id
  on public.bookings
  for each row execute function public.check_booking_org();

-- ---------- Offboarding guard + immutable columns
create or replace function public.staff_guard_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id then raise exception 'org mismatch'; end if;
  if new.user_id is distinct from old.user_id and old.user_id is not null then
    raise exception 'user_id immutable';
  end if;
  if old.active and not new.active then
    if not exists (select 1 from public.staff s where s.org_id = old.org_id and s.active and s.id <> old.id) then
      raise exception 'last_active_staff';
    end if;
    if exists (select 1 from public.bookings b where b.staff_id = old.id and b.status = 'confirmed' and b.starts_at > now()) then
      raise exception 'has_future_bookings';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists staff_guard_update on public.staff;
create trigger staff_guard_update before update on public.staff
  for each row execute function public.staff_guard_update();

-- ---------- create_org seeds the first staff row (0001 body + one insert)
create or replace function public.create_org(p_name text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
  v_slug text;
  v_staff_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_staff_slug := trim(both '-' from left(v_slug, 40));
  if length(v_staff_slug) < 2 then v_staff_slug := v_staff_slug || '-1'; end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.orgs (name, slug) values (trim(p_name), v_slug) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  -- staff.name is capped at 80; orgs.name is not, so clamp rather than fail.
  insert into public.staff (org_id, name, slug, color, sort_order)
    values (v_org.id, left(trim(p_name), 80), v_staff_slug, '#4f46e5', 0);
  return v_org;
end; $$;
grant execute on function public.create_org(text) to authenticated;

-- ---------- create_staff: row + copy first active staff's schedule + fan-out
create or replace function public.create_staff(
  p_org_id uuid, p_name text, p_slug text, p_email text, p_color text, p_service_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_source uuid;
  v_max_sort int;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  select s.id into v_source from public.staff s
    where s.org_id = p_org_id and s.active order by s.sort_order, s.created_at limit 1;
  select coalesce(max(sort_order), -1) into v_max_sort from public.staff where org_id = p_org_id;
  insert into public.staff (org_id, name, slug, email, color, sort_order)
    values (p_org_id, btrim(p_name), p_slug, lower(p_email), p_color, v_max_sort + 1)
    returning id into v_id;
  if v_source is not null then
    insert into public.availability_rules (org_id, staff_id, weekday, start_time, end_time)
      select org_id, v_id, weekday, start_time, end_time from public.availability_rules where staff_id = v_source;
    insert into public.availability_exceptions (org_id, staff_id, date, closed, start_time, end_time)
      select org_id, v_id, date, closed, start_time, end_time
        from public.availability_exceptions where staff_id = v_source and date >= current_date;
  end if;
  insert into public.service_staff (org_id, service_id, staff_id)
    select p_org_id, s.id, v_id from public.services s
      where s.org_id = p_org_id and s.id = any(coalesce(p_service_ids, '{}'::uuid[]));
  return v_id;
end; $$;
revoke all on function public.create_staff(uuid, text, text, text, text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.create_staff(uuid, text, text, text, text, uuid[]) to authenticated;

-- PostgREST caches the schema; the new tables/RPC must be visible immediately.
notify pgrst, 'reload schema';

-- ============================================================================
-- Task 3: the booking write path becomes staff-keyed.
-- ============================================================================

-- ---------- slot_within_availability: staff-keyed (0028 body, org -> staff).
-- Same argument types as the 0028 version but a different first parameter
-- NAME, so `create or replace` is rejected — drop first. plpgsql bodies carry
-- no dependencies, so the 0028 callers (reschedule_booking{,_admin}) keep
-- resolving the name; Task 4 re-points them at the staff.
drop function if exists public.slot_within_availability(uuid, text, timestamptz, timestamptz);
create function public.slot_within_availability(
  p_staff_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz
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
  if exists (select 1 from public.availability_exceptions ae where ae.staff_id = p_staff_id and ae.date = v_date) then
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.staff_id = p_staff_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm);
  end if;
  return exists (
    select 1 from public.availability_rules ar
    where ar.staff_id = p_staff_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm);
end; $$;
revoke all on function public.slot_within_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- staff_is_free: no confirmed overlap on the staff (excluding one row)
create or replace function public.staff_is_free(
  p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.staff_id = p_staff_id and b.status = 'confirmed'
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at));
$$;
revoke all on function public.staff_is_free(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- ---------- pick_staff_for_slot: "Anyone available" assignment (spec: least
-- confirmed bookings that org-local day, tie -> sort_order, created_at).
create or replace function public.pick_staff_for_slot(
  p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid[]
) returns uuid language sql stable set search_path = '' as $$
  select st.id
  from public.service_staff ss
  join public.staff st on st.id = ss.staff_id
  where ss.service_id = p_service_id and st.active
    and st.id <> all(coalesce(p_exclude, '{}'::uuid[]))
    and public.slot_within_availability(st.id, p_timezone, p_starts_at, p_ends_at)
    and public.staff_is_free(st.id, p_starts_at, p_ends_at, null)
  order by (
      select count(*) from public.bookings b
      where b.staff_id = st.id and b.status = 'confirmed'
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated, service_role;

-- ---------- create_booking v3: + p_staff_id (null = auto-assign), returns staff.
-- The return type changes, so the 0026/0034 seven-arg form is dropped (its
-- grants do not survive) and the anon grant is re-issued below. `or replace`
-- on the new eight-arg form keeps this file re-appliable.
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text);
create or replace function public.create_booking(
  p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_note text, p_token_hash text, p_staff_id uuid default null
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
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;
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
      v_staff := public.pick_staff_for_slot(p_service_id, v_org.timezone, p_starts_at, v_ends_at, v_tried);
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
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) to anon;

-- ---------- create_booking_admin v3: + required p_staff_id (0031 body)
drop function if exists public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer);
create or replace function public.create_booking_admin(
  p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text, p_note text,
  p_token_hash text, p_duration_min integer, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_service record;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select s.id, s.org_id, s.duration_min into v_service
    from public.services s where s.id = p_service_id and s.org_id in (select public.user_orgs()) and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
    where st.id = p_staff_id and st.org_id = v_service.org_id and st.active and ss.service_id = p_service_id
  ) then raise exception 'staff_unavailable'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '24 hours' or p_starts_at > now() + interval '365 days' then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_duration_min is not null and p_duration_min not between 5 and 480 then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => coalesce(p_duration_min, v_service.duration_min));
  if p_email is not null then
    insert into public.clients (org_id, name, email) values (v_service.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null do update set name = excluded.name
    returning id into v_client_id;
  end if;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_service.org_id, p_service_id, p_staff_id, v_client_id, btrim(p_name), lower(p_email), p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;
  return v_booking_id;
end; $$;
revoke all on function public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer, uuid) to authenticated;

-- Both RPC signatures changed; PostgREST must re-read its schema cache.
notify pgrst, 'reload schema';
