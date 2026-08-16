-- 0034 (S5): anon re-booking no longer renames the client.
-- create_booking's client upsert previously did `set name = excluded.name`,
-- letting anyone who typed a known email rename that client in the provider's
-- directory (unverified input; deferred from S1). First-typed name now
-- sticks; the provider renames via the clients directory (member-RLS update
-- on clients, 0018). create_booking_admin (0031) keeps rename-on-conflict on
-- purpose — walk-in input is the provider's own, authenticated. The booking
-- row still records whatever the booker typed (client_name).
-- Same signature; OR REPLACE keeps the existing anon EXECUTE grant (0028 idiom).
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
  -- 0034 change: keep the existing name (no-op update so RETURNING still
  -- yields the row) instead of `excluded.name`.
  do update set name = clients.name
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
