-- Custom SQL migration file, put your code below! --

-- Booking lifecycle security model (pivot slice S2):
--   * Client cancel/reschedule: anon-callable definer RPCs keyed on the
--     manage-token hash — the create_booking capability model. Uniform
--     empty-result/raise on any miss.
--   * Reschedule = old row -> 'rescheduled' + new linked row, ONE
--     transaction; the EXCLUDE guard settles races (23P01 => rollback,
--     old booking stays confirmed).
--   * Admin cancel: the column-scoped status-update seam reserved in 0026.
--   * create_booking hardening (accepted S1 residual, plan deviation #7):
--     per-org insert throttle + availability containment now live INSIDE
--     the RPC. Grid/buffers/min-notice/max-per-day stay app-side.

-- ---------- Reminder drain scan (columns in 0027). Partial indexes are
-- not expressible in the TS schema (established limitation).
create index bookings_reminder_due_idx
  on public.bookings (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- ---------- Availability containment: [starts,ends) must sit inside one
-- bookable window of the org-local date. Mirrors the slot engine's COARSE
-- semantics: rules per weekday; open exceptions REPLACE the day's rules;
-- closed exceptions kill the day; windows never cross local midnight
-- (end_time caps at 23:59 by CHECK).
create or replace function public.slot_within_availability(
  p_org_id uuid,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start_local timestamp := p_starts_at at time zone p_timezone;
  v_end_local   timestamp := p_ends_at   at time zone p_timezone;
  v_date date := v_start_local::date;
  v_start_hm text := to_char(v_start_local, 'HH24:MI');
  v_end_hm   text := to_char(v_end_local,   'HH24:MI');
  v_weekday int := extract(dow from v_start_local)::int; -- 0=Sunday, matches JS
begin
  if v_end_local::date <> v_date then
    return false;
  end if;

  if exists (
    select 1 from public.availability_exceptions ae
    where ae.org_id = p_org_id and ae.date = v_date
  ) then
    -- Closed rows have null windows and can never contain the slot.
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.org_id = p_org_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm
    );
  end if;

  return exists (
    select 1 from public.availability_rules ar
    where ar.org_id = p_org_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm
  );
end;
$$;

-- Internal helper: only definer functions call it (as owner) — no role
-- needs EXECUTE.
revoke all on function public.slot_within_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- Hardened create_booking (same signature; OR REPLACE keeps the
-- existing anon EXECUTE grant). Adds: per-org throttle + containment.
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
  v_recent int;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = p_service_id and s.org_id = v_org.id and s.active;
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

  -- S2 hardening 1: per-org creation throttle. The app-side limiter is
  -- per-IP+instance; this is the direct-PostgREST backstop. 30/min matches
  -- publicBookingLimiter.
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  -- S2 hardening 2: availability containment.
  if not public.slot_within_availability(v_org.id, v_org.timezone, p_starts_at, v_ends_at) then
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
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

-- ---------- Client cancel: atomic claim keyed on the token hash. Only a
-- confirmed, future booking flips; empty result = miss/no-op (uniform,
-- like the resolver). Returns what the caller needs for the two emails.
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');

  update public.bookings b
    set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash
      and b.status = 'confirmed'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then return; end if;

  return query
    select b.id, b.org_id, o.name, o.timezone, s.name, b.client_name, b.client_email, b.starts_at
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.id = v_id;
end;
$$;

revoke all on function public.cancel_booking(text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to anon;

-- ---------- Client reschedule: one transaction. Old row is freed FIRST so
-- shifting a booking by less than its own duration cannot self-conflict;
-- a 23P01 on the insert rolls everything back (old stays confirmed).
create or replace function public.reschedule_booking(
  p_token text,
  p_starts_at timestamptz,
  p_new_token_hash text
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  new_starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_old record;
  v_service record;
  v_tz text;
  v_ends_at timestamptz;
  v_new_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');

  select b.id, b.org_id, b.service_id, b.client_id, b.client_name, b.client_email,
         b.note, b.starts_at
    into v_old
    from public.bookings b
    where b.cancel_token_hash = v_hash
      and b.status = 'confirmed'
      and b.starts_at > now()
    for update;
  if v_old.id is null then return; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;

  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.org_id, v_tz, p_starts_at, v_ends_at) then
    raise exception 'not found';
  end if;

  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends_at, 'confirmed', p_new_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;

  return query
    select v_new_id, v_old.org_id, o.name, o.timezone, s.name,
           v_old.client_name, v_old.client_email, v_old.starts_at, p_starts_at
    from public.orgs o, public.services s
    where o.id = v_old.org_id and s.id = v_old.service_id;
end;
$$;

revoke all on function public.reschedule_booking(text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking(text, timestamptz, text) to anon;

-- ---------- Admin reschedule (update_org_scheduling idiom: user_orgs
-- membership check, generic raises). Old booking may be past-started
-- (provider fixing a missed appointment); the NEW time must be future,
-- inside the window, and available.
create or replace function public.reschedule_booking_admin(
  p_booking_id uuid,
  p_starts_at timestamptz,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_service record;
  v_tz text;
  v_ends_at timestamptz;
  v_new_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  select b.id, b.org_id, b.service_id, b.client_id, b.client_name, b.client_email, b.note
    into v_old
    from public.bookings b
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'confirmed'
    for update;
  if v_old.id is null then raise exception 'not found'; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;

  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.org_id, v_tz, p_starts_at, v_ends_at) then
    raise exception 'not found';
  end if;

  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.reschedule_booking_admin(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking_admin(uuid, timestamptz, text)
  to authenticated;

-- ---------- Resolver v2: + org_id, service_id (manage page needs them to
-- load the reschedule slot context). Return-type change forces DROP —
-- grants do not survive, re-applied below.
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
  service_id uuid
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
    select b.id, b.status, b.starts_at, b.ends_at, s.name, o.name, o.timezone,
           b.org_id, b.service_id
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.cancel_token_hash = v_hash;
end;
$$;

revoke all on function public.resolve_booking_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

-- ---------- The 0026-reserved seam: staff cancel via column-scoped status
-- update. USING pins the pre-state (only confirmed rows are touchable),
-- WITH CHECK pins the post-state (only cancelled_by_provider). Everything
-- else — reschedule, un-cancel — is RPC-only or intentionally impossible.
grant update (status) on table public.bookings to authenticated;

create policy "bookings_update_member" on public.bookings
  for update to authenticated
  using (org_id in (select public.user_orgs()) and status = 'confirmed')
  with check (org_id in (select public.user_orgs()) and status = 'cancelled_by_provider');
