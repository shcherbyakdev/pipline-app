-- Helper: the org IDs the current user belongs to. SECURITY DEFINER so it can
-- read org_members regardless of RLS (avoids policy recursion). STABLE + empty
-- search_path for safety.
create or replace function public.user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

grant execute on function public.user_orgs() to authenticated;

-- Enable RLS on both tenant tables.
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- Members may read their own orgs / memberships. No insert/update/delete
-- policies: mutations happen only through create_org() below.
create policy "orgs_select_member" on public.orgs
  for select to authenticated
  using (id in (select public.user_orgs()));

create policy "org_members_select_member" on public.org_members
  for select to authenticated
  using (org_id in (select public.user_orgs()));

-- Atomic onboarding bootstrap: create an org and the caller's owner membership.
-- SECURITY DEFINER so it can insert despite the absence of insert policies.
create or replace function public.create_org(p_name text)
returns public.orgs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.orgs;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'org';
  end if;
  -- Guarantee uniqueness without a retry loop.
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.orgs (name, slug)
  values (trim(p_name), v_slug)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  return v_org;
end;
$$;

grant execute on function public.create_org(text) to authenticated;
