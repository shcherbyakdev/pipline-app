-- S3 — change consequences (spec docs/superpowers/specs/2026-09-07-s3-change-consequences-design.md).
-- Tiered cancellation policy on the space, snapshotted per booking; fee_cents
-- on the booking; one pure helper; cancel + both reschedule cores compute the
-- fee in SQL. Drops cancel_window_min (deploy with the app in one window).

-- ---------- columns
alter table public.rental_offerings
  add column cancel_policy jsonb not null default '[]'::jsonb,
  add constraint rental_offerings_cancel_policy_ck check (jsonb_typeof(cancel_policy) = 'array');
--> statement-breakpoint
alter table public.bookings
  add column cancel_policy jsonb,
  add column fee_cents integer not null default 0,
  add constraint bookings_cancel_policy_ck check (cancel_policy is null or jsonb_typeof(cancel_policy) = 'array'),
  add constraint bookings_fee_cents_ck check (fee_cents >= 0);
--> statement-breakpoint

-- ---------- backfills: "free until W" → one free tier (then 100%, ruling 5);
-- live rental bookings keep the window their client accepted.
update public.rental_offerings
  set cancel_policy = jsonb_build_array(jsonb_build_object('beforeMin', cancel_window_min, 'feePct', 0))
  where cancel_window_min > 0;
--> statement-breakpoint
update public.bookings b
  set cancel_policy = ro.cancel_policy
  from public.rental_offerings ro
  where ro.id = b.rental_offering_id
    and b.status in ('confirmed', 'pending', 'pending_payment')
    and b.starts_at > now();
--> statement-breakpoint
alter table public.rental_offerings
  drop constraint if exists rental_offerings_cancel_window_ck,
  drop column cancel_window_min;
--> statement-breakpoint

-- ---------- the helper (pure; the TS twin is cancelFeePct in
-- src/features/rentals/cancel-policy.ts — lockstep-tested). The tier with
-- the largest lead the moment still meets; none met → 100; empty → 0.
create function public.cancel_fee_pct(p_policy jsonb, p_starts_at timestamptz, p_at timestamptz)
returns int language sql immutable set search_path = '' as $$
  select coalesce(
    (select (t->>'feePct')::int
       from jsonb_array_elements(coalesce(p_policy, '[]'::jsonb)) t
      where p_at <= p_starts_at - make_interval(mins => (t->>'beforeMin')::int)
      order by (t->>'beforeMin')::int desc
      limit 1),
    case when jsonb_array_length(coalesce(p_policy, '[]'::jsonb)) = 0 then 0 else 100 end);
$$;
--> statement-breakpoint
revoke all on function public.cancel_fee_pct(jsonb, timestamptz, timestamptz) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- The lockstep test calls it as service_role; it reads no table.
grant execute on function public.cancel_fee_pct(jsonb, timestamptz, timestamptz) to service_role;
--> statement-breakpoint

-- ---------- triggers (base 0079). BEFORE INSERT: the policy snapshot — from
-- the old row on a reschedule, else from the offering — one place for every
-- insert path (public create, accept, admin walk-in, both reschedule cores).
create or replace function public.carry_booking_locale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    if new.locale is null then
      select b.locale into new.locale from public.bookings b where b.id = new.rescheduled_from_id;
    end if;
    -- S2: money carries (spec §Flows "Reschedule": paid_cents carries).
    -- S3: so does the policy the client accepted.
    select b.paid_cents, b.refunded_cents, b.cancel_policy
      into new.paid_cents, new.refunded_cents, new.cancel_policy
      from public.bookings b where b.id = new.rescheduled_from_id;
  elsif new.cancel_policy is null and new.rental_offering_id is not null then
    select ro.cancel_policy into new.cancel_policy
      from public.rental_offerings ro where ro.id = new.rental_offering_id;
  end if;
  return new;
end; $$;
--> statement-breakpoint
-- AFTER INSERT: the ledger follows the live row (S2) and the old row is
-- zeroed (S3 ruling 10) — money lives on one row, every SUM is right.
create or replace function public.carry_booking_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    update public.booking_payments set booking_id = new.id, updated_at = now()
      where booking_id = new.rescheduled_from_id;
    update public.bookings set paid_cents = 0, refunded_cents = 0, fee_cents = 0
      where id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
--> statement-breakpoint

-- ---------- cancel_booking (base: 0079). The window gate and its sentinel
-- go (ruling 5): a confirmed rental cancels at the tier's fee, a hold or a
-- pending request withdraws free. SET reads the OLD row.
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b
    set status = 'cancelled_by_client',
        fee_cents = case
          when b.status = 'confirmed' and b.price_cents is not null
            then round(b.price_cents * public.cancel_fee_pct(b.cancel_policy, b.starts_at, now()) / 100.0)::int
          else 0 end
    where b.cancel_token_hash = v_hash and b.starts_at > now()
      and b.status in ('confirmed', 'pending', 'pending_payment')
    returning b.id into v_id;
  if v_id is null then return; end if;
  return query
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, public.booking_title(ro.name, u.name)),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
--> statement-breakpoint
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.cancel_booking(text) to service_role;
--> statement-breakpoint

-- ---------- resolve_booking_token (base: 0079): cancel_window_min →
-- cancel_policy (the booking's snapshot), + fee_cents. Return type changes:
-- drop + create.
drop function public.resolve_booking_token(text);
--> statement-breakpoint
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_policy jsonb, decline_note text,   -- S3
  lines jsonb, people int,
  hold_expires_at timestamptz, paid_cents int, refunded_cents int,                            -- S2
  fee_cents int                                                                               -- S3
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, b.cancel_policy, b.decline_note,
           b.lines, b.people,
           b.hold_expires_at, b.paid_cents, b.refunded_cents,
           b.fee_cents
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
--> statement-breakpoint
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.resolve_booking_token(text) to anon, service_role;
--> statement-breakpoint

-- ---------- reschedule_rental_hours_apply (base: 0078, lines 315–484 of
-- 0078_pricing_rules.sql, body copied verbatim except the five S3 edits
-- marked below). A client move (p_enforce_limits) inside a fee tier carries
-- the tier's fee onto the new row, accumulating (ruling 8).
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
    v_lines := public.rental_quote_hours(v_off.id, p_starts_at, v_duration, v_people, v_extras);
  exception when others then
    if sqlerrm not in ('quote_band', 'quote_people', 'quote_extra') then raise; end if;
    v_carry := true;
  end;
  if v_carry then
    v_lines := v_old.lines;
    v_total := v_old.price_cents;
    v_people := v_old.people;
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

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people,                                                                   -- S1
     fee_cents)                                                                       -- S3 (edit 3)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end, v_people,  -- S1
     v_old.fee_cents + v_fee)                                                         -- S3 (edit 4)
  returning id into v_new_id;

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

-- ---------- reschedule_rental_apply (base: 0070, lines 108–236 of
-- 0070_booking_title.sql, body copied verbatim except the same edits).
create or replace function public.reschedule_rental_apply(
  p_old_id uuid,
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
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
  v_today date;
  v_len int;
  v_night_adj int;
  v_occ_start date;
  v_occ_end date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_unit uuid;
  v_new_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
  v_fee int := 0;   -- S3
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at,
         b.price_cents, b.cancel_policy, b.fee_cents                                  -- S3 (edit 1)
    into v_old
    from public.bookings b
    where b.id = p_old_id
    for update;
  if v_old.id is null or v_old.rental_offering_id is null or v_old.status <> 'confirmed' then
    raise exception 'not found';
  end if;
  -- R2 rule: a stay that has begun cannot be moved (the client is in the
  -- unit). Distinct message so the callers can say so.
  if v_old.starts_at <= now() then raise exception 'started'; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'not found'; end if;

  select o.id, o.name, o.timezone, o.currency into v_org from public.orgs o where o.id = v_old.org_id;
  select * into v_off from public.rental_offerings ro
    where ro.id = v_old.rental_offering_id and ro.active;
  if v_off.id is null then raise exception 'not found'; end if;

  v_today := (now() at time zone v_org.timezone)::date;
  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_start_date < v_today + v_off.min_notice_days then raise exception 'not found'; end if;
    if p_end_date > v_today + v_off.booking_window_days then raise exception 'not found'; end if;
    -- S3 (edit 2)
    if v_old.price_cents is not null then
      v_fee := round(v_old.price_cents * public.cancel_fee_pct(v_old.cancel_policy, v_old.starts_at, now()) / 100.0)::int;
    end if;
  end if;

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
  if v_ends <= v_starts or v_starts <= now() then raise exception 'not found'; end if;

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
        and public.rental_unit_is_free(u.id, v_org.timezone, v_off.range_mode,
                                       v_occ_start, v_occ_end, v_off.turnover_days, v_old.id);
  else
    select u.id into v_unit
      from public.rental_units u
      where u.offering_id = v_off.id and u.active
        and public.rental_unit_is_free(u.id, v_org.timezone, v_off.range_mode,
                                       v_occ_start, v_occ_end, v_off.turnover_days, v_old.id)
      order by (u.id = v_old.rental_unit_id) desc, u.sort_order, u.created_at
      limit 1;
  end if;
  if v_unit is null then raise exception 'taken'; end if;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at,
     fee_cents)                                                                       -- S3 (edit 3)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     v_starts, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     v_old.fee_cents + v_fee)                                                         -- S3 (edit 4)
  returning id into v_new_id;

  return query
    select v_new_id, v_old.org_id, v_org.name, v_org.timezone,
           public.booking_title(v_off.name, u.name), v_old.client_name, v_old.client_email,
           v_old.starts_at, v_old.ends_at, v_starts, v_ends,
           (v_unit <> v_old.rental_unit_id),
           (v_starts <> v_old.starts_at or v_ends <> v_old.ends_at)
    from public.rental_units u
    where u.id = v_unit;
end;
$$;
--> statement-breakpoint
revoke all on function public.reschedule_rental_apply(uuid, uuid, date, date, text, boolean)
  from public, anon, authenticated, service_role;

-- Rollback: drop function cancel_fee_pct; drop + recreate resolve_booking_token
-- from 0079; `create or replace` cancel_booking from 0079, carry_booking_locale
-- and carry_booking_payments from 0079, reschedule_rental_hours_apply from
-- 0078, reschedule_rental_apply from 0070;
--   alter table public.rental_offerings add column cancel_window_min int not null default 0,
--     add constraint rental_offerings_cancel_window_ck check (cancel_window_min >= 0);
--   update public.rental_offerings set cancel_window_min = coalesce((cancel_policy->0->>'beforeMin')::int, 0);
--   alter table public.rental_offerings drop column cancel_policy;
--   alter table public.bookings drop column cancel_policy, drop column fee_cents;
