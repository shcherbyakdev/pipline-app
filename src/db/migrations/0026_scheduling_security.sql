-- Custom SQL migration file, put your code below! --

-- Scheduling security model (pivot slice S1):
--   * services / availability_rules / availability_exceptions: ordinary
--     member CRUD (participants/0013 idiom) — staff manage them directly
--     under RLS.
--   * bookings: created ONLY by the anon-callable create_booking definer
--     RPC (the public page's single write path); staff read them; S2 adds
--     column-scoped status updates. No delete — bookings are history.
--   * Double-booking is impossible at the DB level: EXCLUDE USING gist
--     over (org_id, tstzrange(starts_at, ends_at)) on confirmed rows.
--     First use of btree_gist in this repo.
--   * orgs.handle/timezone are written only via update_org_scheduling
--     (orgs stays select-only for authenticated — 0004/0018 idiom).

create extension if not exists btree_gist;

-- ---------- Self-FK deferred from 0025 (module-cycle idiom, cf. 0020)
alter table public.bookings
  add constraint bookings_rescheduled_from_id_fk
  foreign key (rescheduled_from_id) references public.bookings(id)
  on delete set null;

-- ---------- CHECKs (text-column enums + sanity, the 0008 idiom)
alter table public.orgs
  add constraint orgs_handle_format_check
  check (handle is null or handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$');

alter table public.services
  add constraint services_duration_check
    check (duration_min between 5 and 480),
  add constraint services_buffer_before_check
    check (buffer_before_min between 0 and 240),
  add constraint services_buffer_after_check
    check (buffer_after_min between 0 and 240),
  add constraint services_min_notice_check
    check (min_notice_min between 0 and 20160),
  add constraint services_window_check
    check (booking_window_days between 1 and 365),
  add constraint services_max_per_day_check
    check (max_per_day is null or max_per_day between 1 and 100);

alter table public.availability_rules
  add constraint availability_rules_weekday_check
    check (weekday between 0 and 6),
  add constraint availability_rules_time_format_check
    check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint availability_rules_order_check
    check (start_time < end_time);

alter table public.availability_exceptions
  add constraint availability_exceptions_shape_check
    check (
      (closed and start_time is null and end_time is null)
      or (not closed
          and start_time is not null
          and end_time is not null
          and start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and start_time < end_time)
    );

alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','cancelled_by_client','cancelled_by_provider','rescheduled')),
  add constraint bookings_order_check
    check (starts_at < ends_at),
  add constraint bookings_client_name_check
    check (length(btrim(client_name)) between 1 and 200),
  add constraint bookings_client_email_check
    check (length(client_email) between 3 and 320),
  add constraint bookings_note_check
    check (note is null or length(note) <= 2000);

-- ---------- THE double-book guard. Rows with '[)' bounds: back-to-back
-- bookings (10:00-10:30, 10:30-11:00) do not conflict. Buffers are an
-- engine concern; the constraint guards the appointment itself against
-- races on the same slot.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    org_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (status = 'confirmed');

-- ---------- Client upsert key for booking-created clients. Partial unique
-- indexes are not expressible in the TS schema (established limitation).
create unique index clients_org_lower_email_uq
  on public.clients (org_id, lower(email))
  where email is not null;

-- ---------- RLS
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.bookings enable row level security;

create policy "services_select_member" on public.services
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "services_insert_member" on public.services
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "services_update_member" on public.services
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "services_delete_member" on public.services
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "availability_rules_select_member" on public.availability_rules
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "availability_rules_insert_member" on public.availability_rules
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "availability_rules_delete_member" on public.availability_rules
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "availability_exceptions_select_member" on public.availability_exceptions
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "availability_exceptions_insert_member" on public.availability_exceptions
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "availability_exceptions_delete_member" on public.availability_exceptions
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "bookings_select_member" on public.bookings
  for select to authenticated using (org_id in (select public.user_orgs()));
-- No insert/update/delete policies for authenticated: creation is the
-- create_booking RPC's job; S2 adds column-scoped status updates.

-- ---------- Grants (0004 doctrine: revoke-then-narrow, truncate explicit,
-- anon starts with nothing thanks to 0013's default-privileges sweep).
revoke insert, update, delete, truncate on table public.services from authenticated;
grant select, insert, update, delete on table public.services to authenticated;
grant select on table public.services to service_role;
revoke truncate on table public.services from authenticated, service_role;

revoke insert, update, delete, truncate on table public.availability_rules from authenticated;
grant select, insert, delete on table public.availability_rules to authenticated;
grant select on table public.availability_rules to service_role;
revoke truncate on table public.availability_rules from authenticated, service_role;

revoke insert, update, delete, truncate on table public.availability_exceptions from authenticated;
grant select, insert, delete on table public.availability_exceptions to authenticated;
grant select on table public.availability_exceptions to service_role;
revoke truncate on table public.availability_exceptions from authenticated, service_role;

revoke insert, update, delete, truncate on table public.bookings from authenticated;
grant select on table public.bookings to authenticated;
-- service_role: insert for test seeding now, update for S2's reminder
-- drain + admin cancel. Never delete — bookings are history.
grant select, insert, update on table public.bookings to service_role;
revoke delete, truncate on table public.bookings from authenticated, service_role;

-- ---------- Org-consistency guard (check_chase_org idiom): a booking's
-- service and client must belong to its org.
create or replace function public.check_booking_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.services where id = new.service_id;
  if v_org is null then raise exception 'service not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
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
end;
$$;

create trigger bookings_org_guard
  before insert or update of org_id, service_id, client_id, rescheduled_from_id
  on public.bookings
  for each row execute function public.check_booking_org();

-- ---------- RPC 1: the public page's single write path. SECURITY DEFINER:
-- anon has no table grants at all; the function IS the capability. Fine-
-- grained slot validity is checked app-side (the engine re-runs before
-- calling); this function enforces org/service integrity, basic input
-- sanity, and lets bookings_no_overlap settle races (23P01 to the caller).
create or replace function public.create_booking(
  p_handle text,
  p_service_id uuid,
  p_starts_at timestamptz,
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
  v_service record;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select id into v_org from public.orgs where handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;

  select id, duration_min, booking_window_days into v_service
    from public.services
    where id = p_service_id and org_id = v_org.id and active;
  if v_service.id is null then raise exception 'not found'; end if;

  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'not found';
  end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'not found';
  end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not found';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'not found';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = excluded.name
  returning id into v_client_id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_org.id, p_service_id, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, p_starts_at + make_interval(mins => v_service.duration_min),
     'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text)
  to anon;

-- ---------- RPC 2: manage-link resolver (resolve_portal_token idiom:
-- anon-exec, hash lookup, uniform empty result on any miss).
create or replace function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid,
  booking_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  org_name text,
  org_timezone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, s.name, o.name, o.timezone
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.cancel_token_hash = v_hash;
end;
$$;

revoke all on function public.resolve_booking_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

-- ---------- RPC 3: the only write path to orgs.handle/timezone
-- (update_org_branding idiom: member check via user_orgs, full-state
-- semantics, generic raises).
create or replace function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = p_org_id;
end;
$$;

revoke all on function public.update_org_scheduling(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text)
  to authenticated;
