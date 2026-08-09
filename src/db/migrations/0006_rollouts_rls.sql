-- Custom SQL migration file, put your code below! --

-- Rollouts security model:
--   * rollouts: RPC-only creation (no insert policy/grant); member select/
--     update/delete; the update GRANT is column-scoped to (name, updated_at)
--     so org_id/template_id can never be repointed by any client.
--   * rollout_stages: IMMUTABLE — select-only policy and select-only grants
--     for both API roles. Rows are written only inside create_rollout
--     (SECURITY DEFINER) and removed only by the rollout's cascade delete
--     (referential actions run as table owner, exempt from grants/RLS).
--   * units: ordinary member-writable rows + org-validation trigger.
-- Grants are explicit per table (0004 convention).

alter table public.rollouts enable row level security;
alter table public.rollout_stages enable row level security;
alter table public.units enable row level security;

-- rollouts: select / update / delete for members. NO insert policy.
create policy "rollouts_select_member" on public.rollouts
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "rollouts_update_member" on public.rollouts
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "rollouts_delete_member" on public.rollouts
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

-- rollout_stages: select only. Immutability lives here.
create policy "rollout_stages_select_member" on public.rollout_stages
  for select to authenticated
  using (org_id in (select public.user_orgs()));

-- units: full member CRUD.
create policy "units_select_member" on public.units
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "units_insert_member" on public.units
  for insert to authenticated
  with check (org_id in (select public.user_orgs()));
create policy "units_update_member" on public.units
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "units_delete_member" on public.units
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

-- Grants (explicit per 0004 convention). Note the column-scoped update on
-- rollouts and the deliberate absence of any write grant on rollout_stages.
grant select, delete on table public.rollouts to authenticated;
grant update (name, updated_at) on table public.rollouts to authenticated;
grant select on table public.rollout_stages to authenticated;
grant select, insert, update, delete on table public.units to authenticated;
grant select, insert, update, delete on table public.rollouts to service_role;
grant select on table public.rollout_stages to service_role;
grant select, insert, update, delete on table public.units to service_role;

-- Defense in depth: units.org_id must match its rollout's real org_id.
-- Runs as the acting user (invoker): a foreign rollout is invisible under
-- RLS, so the lookup returns null -> 'rollout not found'.
create or replace function public.check_unit_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rollout_org uuid;
begin
  select org_id into v_rollout_org
    from public.rollouts
   where id = new.rollout_id;
  if v_rollout_org is null then
    raise exception 'rollout not found';
  end if;
  if v_rollout_org <> new.org_id then
    raise exception 'org mismatch';
  end if;
  return new;
end;
$$;

create trigger units_check_org
before insert or update of rollout_id, org_id on public.units
for each row execute function public.check_unit_org();

-- Atomic copy-on-use creation. SECURITY DEFINER (the create_org precedent):
-- rollout_stages has no write grants for API roles, so an invoker function
-- could not perform the copy. Definer bypasses RLS, therefore every check is
-- explicit: auth, membership (via user_orgs), name validity, stage count.
create or replace function public.create_rollout(p_template_id uuid, p_name text)
returns public.rollouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.templates;
  v_rollout public.rollouts;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_template from public.templates where id = p_template_id;
  if v_template.id is null
     or v_template.org_id not in (select public.user_orgs()) then
    raise exception 'template not found';
  end if;

  v_name := trim(p_name);
  if v_name is null or v_name = '' or char_length(v_name) > 80 then
    raise exception 'invalid name';
  end if;

  if not exists (select 1 from public.template_stages where template_id = v_template.id) then
    raise exception 'template has no stages';
  end if;

  insert into public.rollouts (org_id, template_id, name)
  values (v_template.org_id, v_template.id, v_name)
  returning * into v_rollout;

  insert into public.rollout_stages (rollout_id, org_id, name, position)
  select v_rollout.id, v_template.org_id, ts.name,
         row_number() over (order by ts.position, ts.id) - 1
    from public.template_stages ts
   where ts.template_id = v_template.id;

  return v_rollout;
end;
$$;

grant execute on function public.create_rollout(uuid, text) to authenticated;