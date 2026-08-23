-- 0047 (Landing claim): the public page now answers at /<handle>, so a handle
-- must never shadow an app route; the landing checks availability before
-- signup; onboarding creates the org with its handle + timezone in one call.
-- Idempotent (create or replace; revoke-then-grant).

-- ---------- reserved words: mirror of RESERVED_HANDLES (features/scheduling/handle.ts)
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;

-- ---------- public availability check (anon): format, reserved, taken
-- Handles are public URLs already, so "is this taken" leaks nothing new.
create or replace function public.is_handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_handle is not null
     and p_handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
     and not (p_handle = any (public.reserved_handles()))
     and not exists (select 1 from public.orgs o where o.handle = p_handle)
$$;
revoke all on function public.is_handle_available(text) from public, anon, authenticated, service_role;
grant execute on function public.is_handle_available(text) to anon, authenticated;

-- ---------- update_org_scheduling: 0026 body + the reserved check
create or replace function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = p_org_id;
end;
$$;
revoke all on function public.update_org_scheduling(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text)
  to authenticated;

-- ---------- create_org_with_page: create_org (0041) + handle + timezone, one transaction
-- A taken handle surfaces as 23505 (orgs_handle_unique) and rolls back the
-- org, member and staff rows create_org inserted.
create or replace function public.create_org_with_page(p_name text, p_handle text, p_timezone text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  v_org := public.create_org(p_name);
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text) to authenticated;
