-- One channel per org (2026-09-03): a workspace sells appointments OR
-- spaces, never both. The public side has been one page per channel since
-- 0060; "both" only survived as admin-side branching. App is in test mode,
-- so existing both-orgs are backfilled, not asked.
--   * Backfill: a both-org keeps appointments unless it has no services and
--     at least one space (then it is a spaces org).
--   * orgs_offers_something (at least one, 0054) → orgs_offers_one (exactly one).
--   * create_org (0054 body) / create_org_with_page (0069 body): defaults
--     become appointments-only and the guard is "exactly one".
--   * update_org_modes (0054 body): same guard. Switching stays free —
--     admin RPCs are not channel-gated (0054 ruling), so a hidden channel's
--     rows and bookings keep working from the calendar.

update public.orgs o set offers_rentals = false
 where o.offers_appointments and o.offers_rentals
   and (exists (select 1 from public.services s where s.org_id = o.id)
        or not exists (select 1 from public.rental_offerings r where r.org_id = o.id));
update public.orgs o set offers_appointments = false
 where o.offers_appointments and o.offers_rentals;

alter table public.orgs
  drop constraint if exists orgs_offers_something,
  add constraint orgs_offers_one check (offers_appointments <> offers_rentals);

-- ---------- create_org (0054 body): defaults + guard.
drop function if exists public.create_org(text, boolean, boolean);
create function public.create_org(
  p_name text,
  p_offers_appointments boolean default true,
  p_offers_rentals boolean default false
)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
  v_slug text;
  v_staff_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.org_members m where m.user_id = auth.uid()) then
    raise exception 'already onboarded';
  end if;
  if coalesce(p_offers_appointments, false) = coalesce(p_offers_rentals, false) then
    raise exception 'pick one booking type';
  end if;
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_staff_slug := trim(both '-' from left(v_slug, 40));
  if length(v_staff_slug) < 2 then v_staff_slug := v_staff_slug || '-1'; end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.orgs (name, slug, offers_appointments, offers_rentals)
    values (trim(p_name), v_slug, p_offers_appointments, p_offers_rentals)
    returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  -- staff.name is capped at 80; orgs.name is not, so clamp rather than fail.
  insert into public.staff (org_id, name, slug, color, sort_order)
    values (v_org.id, left(trim(p_name), 80), v_staff_slug, '#4f46e5', 0);
  return v_org;
end; $$;
revoke all on function public.create_org(text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org(text, boolean, boolean) to authenticated;

-- ---------- create_org_with_page (0069 body): defaults only; the guard lives in create_org.
drop function if exists public.create_org_with_page(text, text, text, boolean, boolean, text);
create function public.create_org_with_page(
  p_name text,
  p_handle text,
  p_timezone text,
  p_offers_appointments boolean default true,
  p_offers_rentals boolean default false,
  p_locale text default 'en'
)
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
    raise exception 'invalid timezone';
  end if;
  if p_locale is null or p_locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    raise exception 'invalid locale';
  end if;
  if p_handle is not null and exists (select 1 from public.org_handle_history h where h.handle = p_handle) then
    raise exception 'handle taken' using errcode = 'unique_violation';
  end if;
  v_org := public.create_org(p_name, p_offers_appointments, p_offers_rentals);
  update public.orgs
    set handle = p_handle, timezone = p_timezone, locale = p_locale
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text, boolean, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text, boolean, boolean, text) to authenticated;

-- ---------- update_org_modes (0054 body): exactly one.
create or replace function public.update_org_modes(
  p_org_id uuid,
  p_offers_appointments boolean,
  p_offers_rentals boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'org not found';
  end if;
  if coalesce(p_offers_appointments, false) = coalesce(p_offers_rentals, false) then
    raise exception 'pick one booking type';
  end if;

  update public.orgs
     set offers_appointments = p_offers_appointments,
         offers_rentals = p_offers_rentals
   where id = p_org_id;
end;
$$;

revoke all on function public.update_org_modes(uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_modes(uuid, boolean, boolean) to authenticated;
