-- Custom SQL migration file, put your code below! --

-- Admin walk-in creation (calendar slice). DELIBERATELY relaxed versus
-- create_booking: no availability containment, no min-notice, no throttle
-- (authenticated member only), past grace 24h (recording an appointment
-- that already started). The EXCLUDE guard remains the overlap authority;
-- callers map 23P01. Membership check via user_orgs (0028 admin idiom).
create or replace function public.create_booking_admin(
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
  v_service record;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select s.id, s.org_id, s.duration_min into v_service
    from public.services s
    where s.id = p_service_id
      and s.org_id in (select public.user_orgs())
      and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  if p_starts_at is null
     or p_starts_at < now() - interval '24 hours'
     or p_starts_at > now() + interval '365 days' then
    raise exception 'not found';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'not found';
  end if;
  if p_email is not null and (
       length(p_email) > 320
       or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     ) then
    raise exception 'not found';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'not found';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  if p_email is not null then
    insert into public.clients (org_id, name, email)
    values (v_service.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null
    do update set name = excluded.name
    returning id into v_client_id;
  end if;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_service.org_id, p_service_id, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_booking_admin(uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_admin(uuid, timestamptz, text, text, text, text)
  to authenticated;
