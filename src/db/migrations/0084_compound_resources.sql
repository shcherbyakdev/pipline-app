-- S6 compound resources (docs/superpowers/specs/2026-09-08-s6-compound-resources-design.md).
-- One occupancy row per booking × unit (booking_units) with its own EXCLUDE.
-- A composite (whole studio) blocks every unit of every room it includes; an
-- equipment space's units attach to a room booking as exclusive add-ons.
-- Deploy note: create_rental_booking_hours changes signature (drop/create) —
-- migrate and deploy the build in one window (S1 idiom).

-- ---------- rental_offerings.kind
alter table public.rental_offerings add column kind text not null default 'space';
--> statement-breakpoint
alter table public.rental_offerings
  add constraint rental_offerings_kind_check check (kind in ('space','composite','equipment')),
  add constraint rental_offerings_compound_hours
    check (kind = 'space' or (range_mode = 'hours' and unit_selection = 'auto'));
--> statement-breakpoint

-- ---------- rental_offering_components: which hourly rooms a composite includes.
create table public.rental_offering_components (
  composite_id uuid not null references public.rental_offerings(id) on delete cascade,
  component_id uuid not null references public.rental_offerings(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  primary key (composite_id, component_id)
);
--> statement-breakpoint
create index rental_offering_components_component_idx on public.rental_offering_components (component_id);
--> statement-breakpoint
-- check_rental_unit_org idiom (0037): both offerings in org_id, the parent a
-- composite, the child an hourly plain space (so nesting is impossible).
create function public.check_offering_component()
returns trigger language plpgsql set search_path = '' as $$
declare v_comp record; v_part record;
begin
  if new.composite_id = new.component_id then raise exception 'component is the composite'; end if;
  select org_id, kind into v_comp from public.rental_offerings where id = new.composite_id;
  select org_id, kind, range_mode into v_part from public.rental_offerings where id = new.component_id;
  if v_comp.org_id is null or v_part.org_id is null then raise exception 'offering not found'; end if;
  if v_comp.org_id <> new.org_id or v_part.org_id <> new.org_id then raise exception 'offering not in org'; end if;
  if v_comp.kind <> 'composite' then raise exception 'not a composite'; end if;
  if v_part.kind <> 'space' or v_part.range_mode <> 'hours' then raise exception 'component must be an hourly space'; end if;
  return new;
end; $$;
--> statement-breakpoint
create trigger rental_offering_components_guard
  before insert or update on public.rental_offering_components
  for each row execute function public.check_offering_component();
--> statement-breakpoint
alter table public.rental_offering_components enable row level security;
--> statement-breakpoint
create policy "rental_offering_components_select_member" on public.rental_offering_components
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "rental_offering_components_insert_member" on public.rental_offering_components
  for insert to authenticated with check (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "rental_offering_components_delete_member" on public.rental_offering_components
  for delete to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
revoke all on table public.rental_offering_components from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, delete on table public.rental_offering_components to authenticated;
--> statement-breakpoint
grant select on table public.rental_offering_components to service_role;
--> statement-breakpoint

-- ---------- booking_units: the occupancy record.
create table public.booking_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  rental_unit_id uuid not null references public.rental_units(id) on delete cascade,
  kind text not null check (kind in ('primary','component','equipment')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reserving boolean not null,
  constraint booking_units_range check (ends_at > starts_at),
  constraint booking_units_booking_unit_uq unique (booking_id, rental_unit_id),
  constraint booking_units_no_overlap
    exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
    where (reserving)
);
--> statement-breakpoint
create index booking_units_unit_starts_idx on public.booking_units (rental_unit_id, starts_at);
--> statement-breakpoint
create index booking_units_booking_idx on public.booking_units (booking_id);
--> statement-breakpoint
alter table public.booking_units enable row level security;
--> statement-breakpoint
create policy "booking_units_select_member" on public.booking_units
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
-- Only the definer trigger and the definer RPCs write; the public flows read
-- through the admin client.
revoke all on table public.booking_units from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on table public.booking_units to authenticated, service_role;
--> statement-breakpoint

-- ---------- Backfill BEFORE the trigger exists: one primary row per rental
-- booking. Cannot violate the new EXCLUDE — the old per-unit EXCLUDE already
-- kept reserving rows apart. No composites exist yet, so no component rows.
insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
select b.org_id, b.id, b.rental_unit_id, 'primary', b.starts_at, b.ends_at,
       b.status in ('confirmed','pending','pending_payment')
  from public.bookings b
 where b.rental_unit_id is not null;
--> statement-breakpoint

-- ---------- sync_booking_units: primary + component rows on insert, the
-- reserving flag on status change. Definer: status flips arrive from definer
-- RPCs, the drain (service_role) and RLS'd member updates, none of which
-- holds a write grant on booking_units. Equipment rows are RPC-written.
-- There is no in-place move (reschedule = new row), so starts/ends never
-- change after insert.
create function public.sync_booking_units()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reserving boolean; v_kind text;
begin
  if new.rental_unit_id is null then return new; end if;
  v_reserving := new.status in ('confirmed','pending','pending_payment');
  if tg_op = 'INSERT' then
    insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
    values (new.org_id, new.id, new.rental_unit_id, 'primary', new.starts_at, new.ends_at, v_reserving);
    select ro.kind into v_kind from public.rental_offerings ro where ro.id = new.rental_offering_id;
    if v_kind = 'composite' then
      insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
      select new.org_id, new.id, u.id, 'component', new.starts_at, new.ends_at, v_reserving
        from public.rental_offering_components c
        join public.rental_units u on u.offering_id = c.component_id
       where c.composite_id = new.rental_offering_id
         and u.id <> new.rental_unit_id;
    end if;
  elsif new.status is distinct from old.status then
    update public.booking_units
       set reserving = v_reserving
     where booking_id = new.id and reserving is distinct from v_reserving;
  end if;
  return new;
end; $$;
--> statement-breakpoint
create trigger bookings_sync_units
  after insert or update of status on public.bookings
  for each row execute function public.sync_booking_units();
--> statement-breakpoint

-- ---------- rental_unit_scope: the unit itself plus, for a composite's unit,
-- every unit of every included room. Both free-checks read over this scope,
-- so a whole studio is free only when every room is.
create function public.rental_unit_scope(p_unit_id uuid)
returns setof uuid language sql stable set search_path = '' as $$
  select p_unit_id
  union
  select cu.id
    from public.rental_units u
    join public.rental_offerings ro on ro.id = u.offering_id and ro.kind = 'composite'
    join public.rental_offering_components c on c.composite_id = ro.id
    join public.rental_units cu on cu.offering_id = c.component_id
   where u.id = p_unit_id;
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_scope(uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- rental_unit_is_free (base: 0079): bookings → booking_units over
-- the scope; blackouts over the scope too. Same signature.
create or replace function public.rental_unit_is_free(
  p_unit_id uuid, p_timezone text, p_range_mode text, p_occ_start date, p_occ_end date,
  p_turnover int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'))
    and not exists (
      select 1 from public.booking_units bu
      where bu.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and bu.reserving
        and (p_exclude_booking_id is null or bu.booking_id <> p_exclude_booking_id)
        and daterange((bu.starts_at at time zone p_timezone)::date,
                      greatest((bu.starts_at at time zone p_timezone)::date,
                               (bu.ends_at at time zone p_timezone)::date
                                 - case when p_range_mode = 'nights' then 1 else 0 end
                                 + p_turnover), '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'));
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_is_free(uuid, text, text, date, date, int, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- rental_unit_is_free_hours (base: 0079): same swap.
create or replace function public.rental_unit_is_free_hours(
  p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_turnover_min int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange((p_starts_at at time zone p_timezone)::date,
                         (p_ends_at   at time zone p_timezone)::date, '[]'))
    and not exists (
      select 1 from public.booking_units bu
      where bu.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and bu.reserving
        and (p_exclude_booking_id is null or bu.booking_id <> p_exclude_booking_id)
        and tstzrange(bu.starts_at, bu.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
