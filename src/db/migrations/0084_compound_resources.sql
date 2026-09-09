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
 where b.rental_unit_id is not null and b.ends_at > b.starts_at;
--> statement-breakpoint

-- ---------- sync_booking_units: primary + component rows on insert, the
-- reserving flag on status change. Definer: status flips arrive from definer
-- RPCs, the drain (service_role) and RLS'd member updates, none of which
-- holds a write grant on booking_units. Equipment rows are RPC-written.
-- There is no in-place move (reschedule = new row), so starts/ends never
-- change after insert.
create or replace function public.sync_booking_units()
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
         and u.id <> new.rental_unit_id
       -- Every compound booking takes its units in the same order, so two
       -- racing inserts queue on the EXCLUDE instead of deadlocking on it.
       order by u.id;
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

-- ---------- rental_equipment_lines: priced lines for equipment picks
-- [{offeringId, qty}] of ONE org. TS twin: equipmentLines (pricing.ts),
-- lockstep-tested. Refusals are the 'quote_equipment' sentinel (S1 idiom).
create function public.rental_equipment_lines(p_org_id uuid, p_picks jsonb, p_duration_min int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_lines jsonb := '[]'::jsonb; v_pick jsonb; v_off record; v_qty int; v_units int;
  v_seen uuid[] := '{}'; v_hours numeric := p_duration_min / 60.0;
begin
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 12 then
    raise exception 'quote_equipment';
  end if;
  for v_pick in select * from jsonb_array_elements(p_picks) loop
    if (v_pick->>'offeringId') is null or (v_pick->>'qty') is null then raise exception 'quote_equipment'; end if;
    v_qty := (v_pick->>'qty')::int;
    select ro.id, ro.name, ro.price_cents, ro.pricing_mode into v_off
      from public.rental_offerings ro
     where ro.id = (v_pick->>'offeringId')::uuid and ro.org_id = p_org_id
       and ro.kind = 'equipment' and ro.active;
    if v_off.id is null or v_off.price_cents is null or v_off.id = any(v_seen) then raise exception 'quote_equipment'; end if;
    select count(*) into v_units from public.rental_units u where u.offering_id = v_off.id and u.active;
    if v_qty < 1 or v_qty > v_units then raise exception 'quote_equipment'; end if;
    v_seen := v_seen || v_off.id;
    v_lines := v_lines || jsonb_build_object(
      'kind', 'equipment', 'offeringId', v_off.id, 'label', v_off.name,
      'unit', case when v_off.pricing_mode = 'flat' then 'flat' else 'hour' end,
      'qty', v_qty, 'unitCents', v_off.price_cents,
      'cents', case when v_off.pricing_mode = 'flat' then v_off.price_cents * v_qty
                    else round(v_off.price_cents * v_qty * v_hours)::int end);
  end loop;
  return v_lines;
end; $$;
--> statement-breakpoint
revoke all on function public.rental_equipment_lines(uuid, jsonb, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.rental_equipment_lines(uuid, jsonb, int) to service_role;
--> statement-breakpoint

-- ---------- attach_booking_equipment: qty free units per pick → equipment
-- rows. Prefers the units p_prefer_booking_id held (a moved booking keeps
-- its lamp), then sort_order. Fewer free than asked → 'taken' (physical
-- conflict, never degraded). No advisory lock: equipment has no turnover,
-- the EXCLUDE settles races (ruling 10). Owner-only, called by the RPCs.
create or replace function public.attach_booking_equipment(
  p_booking_id uuid, p_org_id uuid, p_timezone text, p_picks jsonb,
  p_starts_at timestamptz, p_ends_at timestamptz, p_reserving boolean, p_prefer_booking_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_pick jsonb; v_qty int; v_got int;
begin
  -- Sorted: two bookings asking for the same two lamps must lock them in
  -- the same order (see sync_booking_units).
  for v_pick in select value from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb))
                 order by value->>'offeringId' loop
    v_qty := (v_pick->>'qty')::int;
    with free as (
      select u.id
        from public.rental_units u
       where u.offering_id = (v_pick->>'offeringId')::uuid and u.org_id = p_org_id and u.active
         and public.rental_unit_is_free_hours(u.id, p_timezone, p_starts_at, p_ends_at, 0, p_booking_id)
       order by (p_prefer_booking_id is not null and exists (
                   select 1 from public.booking_units pb
                    where pb.booking_id = p_prefer_booking_id and pb.rental_unit_id = u.id)) desc,
                u.sort_order, u.created_at, u.id
       limit v_qty
    )
    insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
    select p_org_id, p_booking_id, free.id, 'equipment', p_starts_at, p_ends_at, p_reserving from free;
    get diagnostics v_got = row_count;
    if v_got < v_qty then raise exception 'taken'; end if;
  end loop;
end; $$;
--> statement-breakpoint
revoke all on function public.attach_booking_equipment(uuid, uuid, text, jsonb, timestamptz, timestamptz, boolean, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- create_rental_booking_hours (base: 0079 lines 213–306): + p_equipment.
drop function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb);
--> statement-breakpoint
create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
  p_people int, p_extras jsonb, p_equipment jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
  v_pay boolean; v_hold int;                                        -- S2
  v_equip jsonb; v_status text;   -- S6
begin
  select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;
  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;
  -- S6: equipment is an add-on, never the room (ruling 5/9).
  if v_off.kind = 'equipment' then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  -- S1: the quote replaces rental_total_cents.
  v_equip := public.rental_equipment_lines(v_org.id, coalesce(p_equipment, '[]'::jsonb), p_duration_min);   -- S6
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb)) || v_equip;
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
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

  -- S2: a deposit on an org with an active payment account is collected
  -- online — the row is held, not confirmed. Approval still comes first.
  v_pay := coalesce(v_deposit, 0) > 0
       and exists (select 1 from public.payment_accounts pa where pa.org_id = v_org.id and pa.status = 'active');
  v_hold := v_org.payment_hold_min;

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

  v_status := case when v_off.requires_approval then 'pending'
                   when v_pay then 'pending_payment' else 'confirmed' end;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people, hold_expires_at)                                                -- S1/S2
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends,
     v_status,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when jsonb_array_length(v_lines) = 0 then null
          when v_off.pricing is null and jsonb_array_length(v_equip) = 0 then null
          else v_lines end,                                                            -- S1/S6
     case when v_off.pricing ? 'people' then coalesce(p_people, (v_off.pricing->'people'->>'included')::int) end,  -- S1
     case when (not v_off.requires_approval) and v_pay
          then least(now() + make_interval(mins => v_hold), p_starts_at) end)       -- S2
  returning id into v_booking_id;

  -- S6: the trigger has written the primary (+ component) rows; equipment
  -- is explicit. Runs inside the same transaction — a lost race rolls the
  -- booking back with 'taken'.
  perform public.attach_booking_equipment(v_booking_id, v_org.id, v_org.timezone, coalesce(p_equipment, '[]'::jsonb),
                                          p_starts_at, v_ends, v_status in ('confirmed','pending','pending_payment'), null);

  return v_booking_id;
end; $$;
--> statement-breakpoint
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb) to service_role;
--> statement-breakpoint

-- ---------- create_rental_booking_hours_admin (base: 0078): refuses equipment as the room.
create or replace function public.create_rental_booking_hours_admin(
  p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_off record; v_tz text; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
begin
  select ro.*, o.timezone as org_tz, o.currency as org_currency into v_off
    from public.rental_offerings ro
    join public.orgs o on o.id = ro.org_id
    where ro.id = p_offering_id
      and ro.org_id in (select public.user_orgs())
      and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;
  if v_off.kind = 'equipment' then raise exception 'not found'; end if;
  v_tz := v_off.org_tz;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  -- S1: the quote replaces rental_total_cents. A walk-in has no people
  -- count and no extras — the admin form never asked for them.
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, null, '[]'::jsonb);
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
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
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people)                                                                 -- S1
  values
    (v_off.org_id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note, v_total, v_snap_currency, v_deposit, null,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end, null)  -- S1
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
--> statement-breakpoint
revoke all on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text) to authenticated;
--> statement-breakpoint

-- ---------- reschedule_rental_hours_apply (base: 0081 lines 188–372): carries equipment.
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
  v_lines jsonb;    -- S1
  v_extras jsonb;   -- S1
  v_people int;     -- S1
  v_carry boolean := false;  -- S1
  v_fee int := 0;   -- S3
  v_equipment jsonb; v_equip jsonb; v_new_status text;   -- S6
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at,
         b.lines, b.people, b.price_cents,                                              -- S1
         b.cancel_policy, b.fee_cents                                                   -- S3 (edit 1)
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
  -- S1: re-quote at the new time with the booking's own people and extras.
  -- A confirmed booking must never be stranded by a menu edit, so the picks
  -- are DEGRADED to what the offering still sells: an extra the studio
  -- deleted drops out, a qty over the current maxQty is clamped, and the
  -- head-count is clamped to the current people.max. The join is an inner
  -- one on purpose (a deleted extra has no definition row, so it vanishes);
  -- `with ordinality` + `order by ord` keep the picks in the booked order.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.l->>'extraId',
           'qty', least((l.l->>'qty')::int, (d.d->>'maxQty')::int)) order by l.ord), '[]'::jsonb)
    into v_extras
    from jsonb_array_elements(coalesce(v_old.lines, '[]'::jsonb)) with ordinality as l(l, ord)
    join lateral (
      select e from jsonb_array_elements(coalesce(v_off.pricing->'extras', '[]'::jsonb)) e
       where e->>'id' = l.l->>'extraId' limit 1
    ) as d(d) on true
   where l.l->>'kind' = 'extra';
  -- S6: the attached equipment, degraded like the extras — a deleted or
  -- inactive equipment space (or one with no active units) drops out,
  -- qty is clamped to the active unit count. The join carries org_id so a
  -- foreign id in an old snapshot can never be honoured.
  select coalesce(jsonb_agg(jsonb_build_object('offeringId', ro.id, 'qty', least((l.l->>'qty')::int, cnt.n)) order by l.ord), '[]'::jsonb)
    into v_equipment
    from jsonb_array_elements(coalesce(v_old.lines, '[]'::jsonb)) with ordinality as l(l, ord)
    join public.rental_offerings ro
      on ro.id = (l.l->>'offeringId')::uuid and ro.org_id = v_old.org_id
     and ro.kind = 'equipment' and ro.active and ro.price_cents is not null
    join lateral (select count(*)::int as n from public.rental_units u where u.offering_id = ro.id and u.active) cnt on cnt.n > 0
   where l.l->>'kind' = 'equipment';
  -- least() ignores NULLs, so the no-head-count case is spelled out first;
  -- the clamp only applies while the offering still charges by people, and
  -- a dropped people rule keeps the count as a plain booking fact.
  v_people := case
    when v_old.people is null then null
    when v_off.pricing ? 'people' then least(v_old.people, (v_off.pricing->'people'->>'max')::int)
    else v_old.people end;
  -- Last resort: the quote can still refuse (the first band now starts above
  -- the booked duration). Carry the old snapshot forward rather than strand
  -- the booking — anything that is NOT one of the quote's own sentinels is a
  -- real failure and must propagate.
  begin
    v_equip := public.rental_equipment_lines(v_old.org_id, v_equipment, v_duration);
    v_lines := public.rental_quote_hours(v_off.id, p_starts_at, v_duration, v_people, v_extras) || v_equip;
  exception when others then
    if sqlerrm not in ('quote_band', 'quote_people', 'quote_extra', 'quote_equipment') then raise; end if;
    v_carry := true;
  end;
  if v_carry then
    v_lines := v_old.lines;
    v_total := v_old.price_cents;
    v_people := v_old.people;
    v_equip := '[]'::jsonb;
  else
    v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
  end if;
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;

  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_starts_at <= now() + make_interval(mins => v_off.min_notice_min) then raise exception 'not found'; end if;
    if p_starts_at > now() + make_interval(days => v_off.booking_window_days + 1) then raise exception 'not found'; end if;
    -- S3 (edit 2): the tier in force NOW against the OLD start, on the OLD
    -- total — the booking being changed is the old one.
    if v_old.price_cents is not null then
      v_fee := round(v_old.price_cents * public.cancel_fee_pct(v_old.cancel_policy, v_old.starts_at, now()) / 100.0)::int;
    end if;
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

  -- S6: reschedule only ever moves an already-confirmed booking (checked
  -- above), so the new row's status is always 'confirmed' too — captured
  -- into a variable so the attach-equipment call below shares one status
  -- test with create's.
  v_new_status := 'confirmed';

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people,                                                                   -- S1
     fee_cents)                                                                       -- S3 (edit 3)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, v_new_status, p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     case when jsonb_array_length(v_lines) = 0 then null
          when v_off.pricing is null and jsonb_array_length(v_equip) = 0 then null
          else v_lines end, v_people,                                                            -- S1/S6
     v_old.fee_cents + v_fee)                                                         -- S3 (edit 4)
  returning id into v_new_id;

  -- S6: re-attach the equipment at the new time, preferring the old
  -- booking's own units (its rows stopped reserving when it was flipped to
  -- 'rescheduled' above). None free → 'taken' (ruling 11).
  perform public.attach_booking_equipment(v_new_id, v_old.org_id, v_org.timezone, v_equipment,
                                          p_starts_at, v_ends, v_new_status in ('confirmed','pending','pending_payment'), v_old.id);

  return query
    select v_new_id, v_old.org_id, v_org.name, v_org.timezone,
           public.booking_title(v_off.name, u.name), v_old.client_name, v_old.client_email,
           v_old.starts_at, v_old.ends_at, p_starts_at, v_ends,
           (v_unit <> v_old.rental_unit_id),
           (p_starts_at <> v_old.starts_at or v_ends <> v_old.ends_at)
    from public.rental_units u
    where u.id = v_unit;
end;
$$;
--> statement-breakpoint
revoke all on function public.reschedule_rental_hours_apply(uuid, uuid, timestamptz, text, boolean)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- a room that a composite includes cannot leave hours mode (0037
-- idiom). check_offering_component only guards the LINK; without this the
-- owner could flip an included room to Nightly and the composite's next save
-- would raise 'component must be an hourly space' with nothing on the page
-- to explain it — and until then the studio would include a room it can no
-- longer block. `update of` fires whenever the columns are written, so a
-- settings save that keeps the room hourly passes untouched.
create or replace function public.check_component_still_hourly()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.range_mode <> 'hours' or new.kind <> 'space')
     and exists (select 1 from public.rental_offering_components c where c.component_id = new.id) then
    raise exception 'included in a whole studio';
  end if;
  return new;
end; $$;
--> statement-breakpoint
create trigger rental_offerings_component_hourly
  before update of range_mode, kind on public.rental_offerings
  for each row execute function public.check_component_still_hourly();
