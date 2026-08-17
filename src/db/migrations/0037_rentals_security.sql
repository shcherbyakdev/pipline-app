-- 0037 (Rentals R1): security surface for rental_offerings / rental_units /
-- rental_unit_blackouts + the bookings split (appointments vs rentals).
-- Idiom: 0026 (CHECKs, RLS, revoke-then-grant, org-guard trigger, definer RPCs).

-- ---------- CHECKs
alter table public.rental_offerings
  add constraint rental_offerings_name_len check (length(name) between 1 and 200),
  add constraint rental_offerings_description_len check (description is null or length(description) <= 2000),
  add constraint rental_offerings_price_label_len check (price_label is null or length(price_label) <= 100),
  add constraint rental_offerings_range_mode check (range_mode in ('nights', 'days')),
  add constraint rental_offerings_start_time_fmt check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint rental_offerings_end_time_fmt check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint rental_offerings_min_stay check (min_stay between 1 and 365),
  add constraint rental_offerings_max_stay check (max_stay is null or (max_stay >= min_stay and max_stay <= 365)),
  add constraint rental_offerings_turnover check (turnover_days between 0 and 30),
  add constraint rental_offerings_min_notice check (min_notice_days between 0 and 365),
  add constraint rental_offerings_window check (booking_window_days between 1 and 730),
  add constraint rental_offerings_unit_selection check (unit_selection in ('auto', 'client_picks'));

alter table public.rental_units
  add constraint rental_units_name_len check (length(name) between 1 and 200),
  add constraint rental_units_description_len check (description is null or length(description) <= 2000);

alter table public.rental_unit_blackouts
  add constraint rental_unit_blackouts_range check (end_date >= start_date),
  add constraint rental_unit_blackouts_reason_len check (reason is null or length(reason) <= 500);

alter table public.bookings
  add constraint bookings_kind check ((service_id is not null) <> (rental_offering_id is not null)),
  add constraint bookings_unit_iff_rental check ((rental_unit_id is not null) = (rental_offering_id is not null));

-- ---------- Guards. The org-level guard now covers appointments only; rentals
-- get a per-unit guard. Turnover is an engine/RPC concern (buffers idiom).
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (org_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed' and rental_unit_id is null);
alter table public.bookings
  add constraint bookings_rental_unit_no_overlap
  exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed' and rental_unit_id is not null);

-- ---------- Org-consistency guards (check_booking_org idiom)
create or replace function public.check_rental_unit_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.rental_offerings where id = new.offering_id;
  if v_org is null then raise exception 'offering not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
create trigger rental_units_org_guard
  before insert or update of org_id, offering_id on public.rental_units
  for each row execute function public.check_rental_unit_org();

create or replace function public.check_rental_unit_blackout_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.rental_units where id = new.rental_unit_id;
  if v_org is null then raise exception 'unit not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
create trigger rental_unit_blackouts_org_guard
  before insert or update of org_id, rental_unit_id on public.rental_unit_blackouts
  for each row execute function public.check_rental_unit_blackout_org();

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
drop trigger bookings_org_guard on public.bookings;
create trigger bookings_org_guard
  before insert or update of org_id, service_id, client_id, rescheduled_from_id, rental_offering_id, rental_unit_id
  on public.bookings
  for each row execute function public.check_booking_org();

-- ---------- RLS
alter table public.rental_offerings enable row level security;
alter table public.rental_units enable row level security;
alter table public.rental_unit_blackouts enable row level security;

create policy "rental_offerings_select_member" on public.rental_offerings
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "rental_offerings_insert_member" on public.rental_offerings
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "rental_offerings_update_member" on public.rental_offerings
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "rental_offerings_delete_member" on public.rental_offerings
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "rental_units_select_member" on public.rental_units
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "rental_units_insert_member" on public.rental_units
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "rental_units_update_member" on public.rental_units
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "rental_units_delete_member" on public.rental_units
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "rental_unit_blackouts_select_member" on public.rental_unit_blackouts
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "rental_unit_blackouts_insert_member" on public.rental_unit_blackouts
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "rental_unit_blackouts_delete_member" on public.rental_unit_blackouts
  for delete to authenticated using (org_id in (select public.user_orgs()));

-- ---------- Grants (0004 doctrine: revoke-then-narrow; anon gets nothing;
-- service_role select so the admin-client public loaders + reminder drain
-- joins can read names).
revoke all on table public.rental_offerings from public, anon;
revoke insert, update, delete, truncate on table public.rental_offerings from authenticated;
grant select, insert, update, delete on table public.rental_offerings to authenticated;
grant select on table public.rental_offerings to service_role;
revoke truncate on table public.rental_offerings from authenticated, service_role;

revoke all on table public.rental_units from public, anon;
revoke insert, update, delete, truncate on table public.rental_units from authenticated;
grant select, insert, update, delete on table public.rental_units to authenticated;
grant select on table public.rental_units to service_role;
revoke truncate on table public.rental_units from authenticated, service_role;

revoke all on table public.rental_unit_blackouts from public, anon;
revoke insert, update, delete, truncate on table public.rental_unit_blackouts from authenticated;
grant select, insert, delete on table public.rental_unit_blackouts to authenticated;
grant select on table public.rental_unit_blackouts to service_role;
revoke truncate on table public.rental_unit_blackouts from authenticated, service_role;

-- ---------- Resolver v3: rentals have no service row. Left-join both kinds,
-- label = service name or 'offering · unit'; append rental_unit_id +
-- range_mode so the manage page can hide reschedule and render a range.
-- Return-type change forces DROP — grants re-applied.
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid,
  booking_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  org_name text,
  org_timezone text,
  org_id uuid,
  service_id uuid,
  rental_unit_id uuid,
  range_mode text
)
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at,
           coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash;
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

-- ---------- cancel_booking v2: same left-join treatment + ends_at.
drop function public.cancel_booking(text);
create function public.cancel_booking(p_token text)
returns table (
  booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  starts_at timestamptz,
  ends_at timestamptz,
  rental_unit_id uuid
)
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b
    set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then return; end if;
  return query
    select b.id, b.org_id, o.name, o.timezone,
           coalesce(s.name, ro.name || ' · ' || u.name),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to anon;
