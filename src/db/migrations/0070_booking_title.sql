-- Booking titles (SQL side of feat/single-unit-spaces): a space's first unit
-- is named after the space and stays so while it is the only one
-- (rentals/actions.ts createOffering / updateOffering), so "Flat · Flat" is
-- what a client used to read on the manage page and in the mails these RPCs
-- feed. One helper spells the rule the app already applies in
-- src/features/rentals/unit-label.ts (withUnit): a unit is named only when
-- it says something the space's name doesn't.
--
-- The four functions below are the CURRENT definitions (0064, 0062, 0058,
-- 0058) copied whole; only the title expression changed. Their privileges
-- are restated exactly as those migrations left them.

create or replace function public.booking_title(p_offering text, p_unit text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_unit is null or p_unit = p_offering then p_offering
    else p_offering || ' · ' || p_unit
  end
$$;
-- Called only from inside the security-definer RPCs below (as their owner):
-- no app role needs it directly (0011 derive_unit_stage precedent).
revoke all on function public.booking_title(text, text) from public, anon, authenticated, service_role;

-- ---------- resolve_booking_token (base: 0064): title via booking_title.
create or replace function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int, decline_note text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min, b.decline_note
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

-- ---------- cancel_booking (base: 0062): title via booking_title.
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash and b.starts_at > now()
      and (b.status = 'pending'
        -- H3: a CONFIRMED rental inside its free-cancellation window cannot
        -- self-cancel; a pending request is always withdrawable.
        or (b.status = 'confirmed'
          and (b.rental_offering_id is null or not exists (
            select 1 from public.rental_offerings ro
            where ro.id = b.rental_offering_id
              and ro.cancel_window_min > 0
              and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)))))
    returning b.id into v_id;
  if v_id is null then
    -- Distinguish "window passed" from a dead token so the manage page can
    -- say so (sentinel idiom: single lowercase word).
    if exists (
      select 1 from public.bookings b
      join public.rental_offerings ro on ro.id = b.rental_offering_id
      where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
        and ro.cancel_window_min > 0
        and now() > b.starts_at - make_interval(mins => ro.cancel_window_min)
    ) then
      raise exception 'cancel_window';
    end if;
    return;
  end if;
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
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to service_role;

-- ---------- reschedule_rental_apply (base: 0058): title via booking_title.
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
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at
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
     price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     v_starts, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at)
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

revoke all on function public.reschedule_rental_apply(uuid, uuid, date, date, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------- reschedule_rental_hours_apply (base: 0058): title via booking_title.
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
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at
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
  v_total := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_duration / 60.0);
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
     price_cents, currency, deposit_cents, terms_accepted_at)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at)
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
