-- S8 migration kit (docs/superpowers/specs/2026-09-09-s8-migration-kit-design.md).
-- Booklo staff import a pilot studio's future bookings from the internal
-- /utils back office while acting as service_role (they are not members of
-- the studio's org). Two existing RPCs learn to accept that caller alongside
-- org members (the list_balances_due idiom, 0083); everything else in their
-- bodies is verbatim. Additive — normal deploy order.

-- ---------- create_rental_booking_hours_admin (base: 0084): the membership
-- gate also admits service_role. Opening hours, the duration grid, turnover
-- and the booking_units EXCLUDE still apply — an import row that does not fit
-- the studio's setup is refused per row, never written.
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
      and (auth.role() = 'service_role' or ro.org_id in (select public.user_orgs()))   -- S8
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
grant execute on function public.create_rental_booking_hours_admin(uuid, uuid, timestamptz, int, text, text, text, text) to authenticated, service_role;
--> statement-breakpoint

-- ---------- mark_booking_paid (base: 0082): same widening, so an imported
-- booking the studio already collected for is settled as a manual payment.
create or replace function public.mark_booking_paid(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b record; v_due int;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id, b.org_id, b.status, b.deposit_cents, b.currency into v_b
    from public.bookings b
    where b.id = p_booking_id
      and (auth.role() = 'service_role' or b.org_id in (select public.user_orgs()))   -- S8
      and b.status in ('pending_payment', 'confirmed') for update;
  if v_b.id is null then raise exception 'not found'; end if;
  if v_b.status = 'pending_payment' then
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'deposit', 'manual', v_b.deposit_cents, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + v_b.deposit_cents where id = v_b.id;
  else
    v_due := public.booking_balance_cents(v_b.id);
    if v_due <= 0 then raise exception 'nothing_due'; end if;
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'balance', 'manual', v_due, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set paid_cents = paid_cents + v_due where id = v_b.id;
  end if;
  return v_b.id;
end; $$;
--> statement-breakpoint
revoke all on function public.mark_booking_paid(uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.mark_booking_paid(uuid) to authenticated, service_role;
