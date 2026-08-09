-- RLS: templates are ordinary member-writable rows (unlike orgs, which are
-- select-only + RPC). Any org member may manage the org's templates; roles
-- come later. Predicate matches 0001's convention.
alter table public.templates enable row level security;
alter table public.template_stages enable row level security;

create policy "templates_select_member" on public.templates
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "templates_insert_member" on public.templates
  for insert to authenticated
  with check (org_id in (select public.user_orgs()));
create policy "templates_update_member" on public.templates
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "templates_delete_member" on public.templates
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

create policy "template_stages_select_member" on public.template_stages
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "template_stages_insert_member" on public.template_stages
  for insert to authenticated
  with check (org_id in (select public.user_orgs()));
create policy "template_stages_update_member" on public.template_stages
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "template_stages_delete_member" on public.template_stages
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

-- Guard: a stage's org_id must reflect the true owner of its template.
-- Without this, a member could insert/repoint a stage with their own
-- org_id while template_id points at a foreign template. Fires on every
-- INSERT and on UPDATE only when template_id or org_id actually changes,
-- so the reorder RPC's position-only updates never trip it. SECURITY
-- INVOKER: the templates lookup runs under the caller's RLS, so a
-- template in another org is invisible (looks like "not found") rather
-- than leaking its existence.
create or replace function public.check_template_stage_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_template_org_id uuid;
begin
  select org_id into v_template_org_id
    from public.templates
   where id = new.template_id;

  if v_template_org_id is null then
    raise exception 'template not found';
  end if;

  if v_template_org_id <> new.org_id then
    raise exception 'org mismatch';
  end if;

  return new;
end;
$$;

create trigger template_stages_check_org
before insert or update of template_id, org_id on public.template_stages
for each row execute function public.check_template_stage_org();

-- Freshness: stage changes touch the parent template's updated_at. Runs as
-- the acting user (RLS applies; members hold the update policy). During a
-- template's cascade delete the UPDATE matches 0 rows, which is fine.
create or replace function public.touch_template_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.templates
     set updated_at = now()
   where id = coalesce(new.template_id, old.template_id);
  return coalesce(new, old);
end;
$$;

create trigger template_stages_touch_parent
after insert or update or delete on public.template_stages
for each row execute function public.touch_template_updated_at();

-- Atomic reorder. SECURITY INVOKER (the default — stated for emphasis):
-- runs as the caller, fully under RLS, so a foreign template simply has no
-- visible rows and fails the count check. Rejects any id set that is not
-- exactly the template's stages (including duplicates).
create or replace function public.reorder_stages(p_template_id uuid, p_stage_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.template_stages
   where template_id = p_template_id;

  if v_count = 0 then
    raise exception 'template not found';
  end if;

  if v_count <> coalesce(array_length(p_stage_ids, 1), 0)
     or v_count <> (select count(distinct s.id) from unnest(p_stage_ids) as s(id))
     or exists (
       select 1 from unnest(p_stage_ids) as s(id)
        where not exists (
          select 1 from public.template_stages ts
           where ts.id = s.id and ts.template_id = p_template_id))
  then
    raise exception 'stage ids do not match template';
  end if;

  update public.template_stages ts
     set position = u.ord - 1
    from unnest(p_stage_ids) with ordinality as u(id, ord)
   where ts.id = u.id;
end;
$$;

grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
