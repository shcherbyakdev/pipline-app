-- 0078 (S1 pricing rules, spec 2026-09-07-s1-pricing-rules-design.md):
-- rental_offerings.pricing holds an hourly space's rules; rental_quote_hours
-- turns rules + a request into line items; the four hourly RPCs snapshot
-- those lines on bookings.lines with price_cents = their sum. pricing NULL
-- keeps every pre-0078 path byte-for-byte.
-- Deploy note: this file DROPS the 9-arg create_rental_booking_hours — ship
-- migration + build in one window (0058 precedent).

-- ---------- columns
alter table public.rental_offerings
  add column pricing jsonb,
  add constraint rental_offerings_pricing_ck
    check (pricing is null or jsonb_typeof(pricing) = 'object'),
  -- Rules only ever describe an hourly space; nights/days never read them.
  add constraint rental_offerings_pricing_hours_ck
    check (pricing is null or range_mode = 'hours');

-- Rules are a price source too: 0058 tied a percent/full deposit to
-- price_cents, which a rules-priced space leaves NULL. Widened, never
-- narrowed — every row that passed the old CHECK passes this one.
alter table public.rental_offerings
  drop constraint rental_offerings_deposit_needs_price_ck,
  add constraint rental_offerings_deposit_needs_price_ck
    check (deposit_type not in ('percent','full') or price_cents is not null or pricing is not null);

alter table public.bookings
  add column lines jsonb,
  add column people int,
  add constraint bookings_lines_ck check (lines is null or jsonb_typeof(lines) = 'array'),
  add constraint bookings_people_ck check (people is null or people >= 0);

-- ---------- the quote. Mirrored line-for-line by pricing.ts quoteHours —
-- the lockstep test (pricing-quote.integration.test.ts) keeps them equal.
create function public.rental_quote_hours(
  p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_off record; v_tz text; v_rules jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_hours numeric := p_duration_min / 60.0;
  v_band jsonb; v_base int; v_unit int;
  v_s jsonb; v_overlap int; v_day date; v_first date; v_last date;
  v_from text; v_to text; v_wstart timestamptz; v_wend timestamptz; v_dow int;
  v_starts timestamptz := p_starts_at; v_ends timestamptz := p_starts_at + make_interval(mins => p_duration_min);
  v_people jsonb; v_n int; v_qty int;
  v_pick jsonb; v_def jsonb; v_seen text[] := '{}'; v_cents int;
begin
  select ro.pricing, ro.pricing_mode, ro.price_cents, o.timezone
    into v_off from public.rental_offerings ro join public.orgs o on o.id = ro.org_id
    where ro.id = p_offering_id;
  if v_off is null then raise exception 'not found'; end if;
  v_tz := v_off.timezone; v_rules := v_off.pricing;

  -- 1. Base.
  if v_rules is null then
    v_base := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_hours);
    if v_base is null then return '[]'::jsonb; end if;
    return jsonb_build_array(jsonb_build_object(
      'kind', 'base', 'qty', v_hours, 'cents', v_base,
      'unitCents', case when v_off.pricing_mode = 'flat' then null else v_off.price_cents end));
  end if;
  select b into v_band from jsonb_array_elements(v_rules->'bands') b
    where (b->>'fromMin')::int <= p_duration_min
    order by (b->>'fromMin')::int desc limit 1;
  if v_band is null then raise exception 'quote_band'; end if;
  if v_band ? 'totalCents' then
    v_base := (v_band->>'totalCents')::int; v_unit := null;
  else
    v_unit := (v_band->>'perHourCents')::int; v_base := round(v_unit * v_hours)::int;
  end if;
  v_lines := v_lines || jsonb_build_object('kind', 'base', 'qty', v_hours, 'unitCents', v_unit, 'cents', v_base);

  -- 2. Surcharges: minutes of overlap with each window, pro-rata on the base.
  v_first := ((v_starts - interval '1 day') at time zone v_tz)::date;
  v_last := (v_ends at time zone v_tz)::date;
  for v_s in select s from jsonb_array_elements(coalesce(v_rules->'surcharges', '[]'::jsonb)) s loop
    v_overlap := 0; v_from := v_s->>'from'; v_to := v_s->>'to';
    v_day := v_first;
    while v_day <= v_last loop
      v_dow := extract(dow from v_day)::int;
      if (v_s->'days') @> to_jsonb(v_dow) then
        v_wstart := (v_day::text || ' ' || v_from)::timestamp at time zone v_tz;
        v_wend := ((case when v_to < v_from then v_day + 1 else v_day end)::text || ' ' || v_to)::timestamp at time zone v_tz;
        if least(v_ends, v_wend) > greatest(v_starts, v_wstart) then
          v_overlap := v_overlap + round(extract(epoch from (least(v_ends, v_wend) - greatest(v_starts, v_wstart))) / 60)::int;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;
    if v_overlap > 0 then
      v_lines := v_lines || jsonb_build_object(
        'kind', 'surcharge', 'qty', v_overlap, 'unitCents', null,
        'cents', round(v_base * (v_s->>'pct')::int / 100.0 * v_overlap / p_duration_min)::int,
        'label', v_s->>'label', 'pct', (v_s->>'pct')::int);
    end if;
  end loop;

  -- 3. People.
  v_people := v_rules->'people';
  if v_people is not null then
    v_n := coalesce(p_people, (v_people->>'included')::int);
    if v_n > (v_people->>'max')::int then raise exception 'quote_people'; end if;
    v_qty := greatest(0, v_n - (v_people->>'included')::int);
    if v_qty > 0 then
      v_lines := v_lines || jsonb_build_object('kind', 'people', 'qty', v_qty,
        'unitCents', (v_people->>'extraCents')::int, 'cents', v_qty * (v_people->>'extraCents')::int);
    end if;
  end if;

  -- 4. Extras.
  for v_pick in select e from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) e loop
    select d into v_def from jsonb_array_elements(coalesce(v_rules->'extras', '[]'::jsonb)) d where d->>'id' = v_pick->>'id';
    -- coalesce: a qty-less pick is a refusal, never a line of null cents.
    v_qty := coalesce((v_pick->>'qty')::int, 0);
    if v_def is null or (v_pick->>'id') = any(v_seen)
       or v_qty < 1 or v_qty > (v_def->>'maxQty')::int then
      raise exception 'quote_extra';
    end if;
    v_seen := v_seen || (v_pick->>'id');
    v_cents := case when v_def->>'unit' = 'hour'
      then round((v_def->>'priceCents')::int * v_qty * v_hours)::int
      else (v_def->>'priceCents')::int * v_qty end;
    v_lines := v_lines || jsonb_build_object('kind', 'extra', 'qty', v_qty,
      'unitCents', (v_def->>'priceCents')::int, 'cents', v_cents,
      'extraId', v_def->>'id', 'label', v_def->>'label', 'unit', v_def->>'unit');
  end loop;
  return v_lines;
end; $$;
revoke all on function public.rental_quote_hours(uuid, timestamptz, int, int, jsonb)
  from public, anon, authenticated, service_role;

create function public.rental_lines_total(p_lines jsonb) returns int language sql immutable set search_path = '' as $$
  select coalesce((select sum((l->>'cents')::int) from jsonb_array_elements(p_lines) l), 0)::int;
$$;
revoke all on function public.rental_lines_total(jsonb) from public, anon, authenticated, service_role;

-- test seam: the lockstep test calls the revoked quote through this wrapper.
create function public.rental_quote_hours_test(
  p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb
) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.rental_quote_hours(p_offering_id, p_starts_at, p_duration_min, p_people, p_extras);
$$;
revoke all on function public.rental_quote_hours_test(uuid, timestamptz, int, int, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.rental_quote_hours_test(uuid, timestamptz, int, int, jsonb) to service_role;

-- ---------- create_rental_booking_hours (base: 0062). The signature grows
-- two trailing params, so the 9-arg one is dropped and recreated.
drop function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text);
create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
  p_people int, p_extras jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
begin
  select o.id, o.timezone, o.currency, o.offers_rentals into v_org
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
  -- S1: the quote replaces rental_total_cents.
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb));
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
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people)                                                                 -- S1
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends,
     case when v_off.requires_approval then 'pending' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end,  -- S1
     case when v_off.pricing ? 'people' then coalesce(p_people, (v_off.pricing->'people'->>'included')::int) end)  -- S1
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb) to service_role;

-- ---------- create_rental_booking_hours_admin (base: 0058): same signature,
-- the quote replaces rental_total_cents.
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
revoke all on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text) to authenticated;

-- ---------- reschedule_rental_hours_apply (base: 0070): the move re-quotes
-- at the NEW time (a night surcharge is earned by the hours actually booked)
-- from the old row's own people count and extra lines.
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
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at,
         b.lines, b.people, b.price_cents                                              -- S1
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
     lines, people)                                                                   -- S1
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end, v_people)  -- S1
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
revoke all on function public.reschedule_rental_hours_apply(uuid, uuid, timestamptz, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------- resolve_booking_token (base: 0070): two more columns, so drop
-- and recreate (the return type changes).
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int, decline_note text,
  lines jsonb, people int                                                          -- S1
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min, b.decline_note,
           b.lines, b.people                                                       -- S1
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon, service_role;

-- Rollback: drop rental_quote_hours_test / rental_lines_total /
-- rental_quote_hours; drop the 11-arg create_rental_booking_hours and
-- recreate the 9-arg one from 0062; drop and recreate resolve_booking_token
-- from 0070; `create or replace` create_rental_booking_hours_admin from 0058
-- and reschedule_rental_hours_apply from 0070; then
--   alter table public.bookings drop column lines, drop column people;
--   alter table public.rental_offerings drop column pricing;
-- (the column CHECKs — rental_offerings_pricing_ck,
-- rental_offerings_pricing_hours_ck, bookings_lines_ck, bookings_people_ck —
-- go with their columns); and restore 0058's narrower
-- rental_offerings_deposit_needs_price_ck.
