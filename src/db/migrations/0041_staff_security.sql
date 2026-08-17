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
