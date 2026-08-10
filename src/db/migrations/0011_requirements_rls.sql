-- Custom SQL migration file, put your code below! --

-- Requirements security model (slice 6):
--   * template_stage_requirements: ordinary member-writable rows
--     (the template_stages precedent) + org-guard trigger + touch trigger.
--   * program_stage_requirements: IMMUTABLE — select-only for both API
--     roles; written only inside create_program (program_stages precedent).
--   * unit_stage_responses: member-writable VALUES ONLY. Clients hold
--     column-scoped grants on the id pair + value columns; a definer
--     BEFORE trigger derives unit_id/program_id/org_id/type from the
--     parent rows and validates the (unit_stage, requirement) pair.
--   * unit_stages.status becomes DERIVED when requirements exist: an
--     AFTER trigger on responses recomputes it (done_source='requirements').
--     A bare status write (the existing staff toggle) is recorded as
--     done_source='override' by the extended maintain trigger.
-- Grants are explicit per table (0004 convention).

-- ---------- CHECKs (kept here with policies/grants, the 0008 pattern)
alter table public.template_stage_requirements
  add constraint template_stage_requirements_type_check
  check (type in ('text','number','boolean','date','choice','checklist','photo'));
alter table public.program_stage_requirements
  add constraint program_stage_requirements_type_check
  check (type in ('text','number','boolean','date','choice','photo'));
alter table public.template_stage_requirements
  add constraint template_stage_requirements_checklist_items_check
  check (type <> 'checklist' or jsonb_typeof(config->'items') = 'array');
alter table public.unit_stage_responses
  add constraint unit_stage_responses_type_check
  check (type in ('text','number','boolean','date','choice'));
alter table public.unit_stage_responses
  add constraint unit_stage_responses_one_value_check
  check (
    (type in ('text','choice') and value_text is not null and value_text <> ''
      and value_number is null and value_bool is null and value_date is null)
    or (type = 'number' and value_number is not null
      and value_text is null and value_bool is null and value_date is null)
    or (type = 'boolean' and value_bool is not null
      and value_text is null and value_number is null and value_date is null)
    or (type = 'date' and value_date is not null
      and value_text is null and value_number is null and value_bool is null)
  );
alter table public.unit_stages
  add constraint unit_stages_done_source_check
  check (done_source in ('requirements','override'));

-- ---------- RLS
alter table public.template_stage_requirements enable row level security;
alter table public.program_stage_requirements enable row level security;
alter table public.unit_stage_responses enable row level security;

create policy "template_stage_requirements_select_member" on public.template_stage_requirements
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_insert_member" on public.template_stage_requirements
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_update_member" on public.template_stage_requirements
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_delete_member" on public.template_stage_requirements
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "program_stage_requirements_select_member" on public.program_stage_requirements
  for select to authenticated using (org_id in (select public.user_orgs()));

create policy "unit_stage_responses_select_member" on public.unit_stage_responses
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_insert_member" on public.unit_stage_responses
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_update_member" on public.unit_stage_responses
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_delete_member" on public.unit_stage_responses
  for delete to authenticated using (org_id in (select public.user_orgs()));

-- ---------- Grants (explicit, 0004 convention)
grant select, insert, update, delete on table public.template_stage_requirements to authenticated;
grant select, insert, update, delete on table public.template_stage_requirements to service_role;
grant select on table public.program_stage_requirements to authenticated;
grant select on table public.program_stage_requirements to service_role;
-- Responses: the id pair appears in BOTH insert and update grants because
-- PostgREST upsert's conflict-UPDATE branch sets every supplied column;
-- repointing is still safe — the prepare trigger re-validates the pair and
-- the derive trigger recomputes BOTH affected unit_stages.
--
-- Local dev images retain a default ACL (ALTER DEFAULT PRIVILEGES for role
-- postgres, schema public) that hands `authenticated` full column
-- privileges on any table postgres creates — CI strips it (the 0004
-- convention already assumes it's absent). id and created_at are the two
-- response columns prepare_unit_stage_response never overwrites (unlike
-- org_id/unit_id/program_id/type, which it unconditionally re-derives), so
-- they need the same revoke-then-narrow-grant treatment as unit_stages
-- below. The revoke must precede the column grants — a table-level revoke
-- drops column-level grants too.
grant select, delete on table public.unit_stage_responses to authenticated;
revoke insert, update on table public.unit_stage_responses from authenticated;
grant insert (unit_stage_id, program_stage_requirement_id, value_text, value_number, value_bool, value_date)
  on table public.unit_stage_responses to authenticated;
grant update (unit_stage_id, program_stage_requirement_id, value_text, value_number, value_bool, value_date)
  on table public.unit_stage_responses to authenticated;
grant select on table public.unit_stage_responses to service_role;

-- Same idiom for unit_stages.done_source: it has no trigger backstop like
-- the responses' derived columns above (maintain_unit_stage_done_at only
-- fires BEFORE UPDATE OF status, so a request touching done_source alone
-- never passes through it), so the grant layer is its only protection.
-- Revoke-then-narrow-grant (the 0008 units precedent) closes the local-ACL
-- gap in both environments.
revoke update on table public.unit_stages from authenticated;
grant update (status) on table public.unit_stages to authenticated;

-- ---------- template_stage_requirements guards (0003 patterns)
create or replace function public.check_template_stage_requirement_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage_org uuid;
begin
  select org_id into v_stage_org
    from public.template_stages
   where id = new.template_stage_id;
  if v_stage_org is null then
    raise exception 'stage not found';
  end if;
  if v_stage_org <> new.org_id then
    raise exception 'org mismatch';
  end if;
  return new;
end;
$$;

create trigger template_stage_requirements_check_org
before insert or update of template_stage_id, org_id on public.template_stage_requirements
for each row execute function public.check_template_stage_requirement_org();

-- Freshness: requirement edits touch the parent template's updated_at.
create or replace function public.touch_template_via_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.templates t
     set updated_at = now()
    from public.template_stages ts
   where ts.id = coalesce(new.template_stage_id, old.template_stage_id)
     and t.id = ts.template_id;
  return coalesce(new, old);
end;
$$;

create trigger template_stage_requirements_touch_parent
after insert or update or delete on public.template_stage_requirements
for each row execute function public.touch_template_via_stage();

-- ---------- reorder RPC (mirror of reorder_stages: invoker, strict id set)
create or replace function public.reorder_stage_requirements(p_template_stage_id uuid, p_requirement_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.template_stage_requirements
   where template_stage_id = p_template_stage_id;

  if v_count = 0 then
    raise exception 'stage not found';
  end if;

  if v_count <> coalesce(array_length(p_requirement_ids, 1), 0)
     or v_count <> (select count(distinct r.id) from unnest(p_requirement_ids) as r(id))
     or exists (
       select 1 from unnest(p_requirement_ids) as r(id)
        where not exists (
          select 1 from public.template_stage_requirements tr
           where tr.id = r.id and tr.template_stage_id = p_template_stage_id))
  then
    raise exception 'requirement ids do not match stage';
  end if;

  update public.template_stage_requirements tr
     set position = u.ord - 1
    from unnest(p_requirement_ids) with ordinality as u(id, ord)
   where tr.id = u.id;
end;
$$;

grant execute on function public.reorder_stage_requirements(uuid, uuid[]) to authenticated;

-- ---------- response trust trigger
-- SECURITY DEFINER so the parent lookups see the real rows; the INSERT/
-- UPDATE statement itself still runs as the caller, so RLS WITH CHECK on
-- the derived org_id is what enforces membership (a foreign unit_stage_id
-- derives a foreign org_id and the write dies at the policy).
create or replace function public.prepare_unit_stage_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_us record;
  v_req record;
begin
  select unit_id, program_stage_id, program_id, org_id into v_us
    from public.unit_stages where id = new.unit_stage_id;
  if v_us.unit_id is null then
    raise exception 'unit stage not found';
  end if;
  select program_stage_id, type into v_req
    from public.program_stage_requirements
   where id = new.program_stage_requirement_id;
  if v_req.program_stage_id is null or v_req.program_stage_id <> v_us.program_stage_id then
    raise exception 'requirement not found';
  end if;
  new.unit_id := v_us.unit_id;
  new.program_id := v_us.program_id;
  new.org_id := v_us.org_id;
  new.type := v_req.type;
  new.answered_by_user_id := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger unit_stage_responses_prepare
before insert or update on public.unit_stage_responses
for each row execute function public.prepare_unit_stage_response();

-- ---------- derivation
-- Recomputes a unit_stage from its responses. A stage derives ONLY when it
-- has >=1 required requirement — zero-requirement (and all-optional) stages
-- stay on the manual toggle, else they would be born 'done'.
create or replace function public.derive_unit_stage(p_unit_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required int;
  v_satisfied int;
  v_done boolean;
begin
  -- photo satisfaction is defined in slice 8 (evidence uploads); until then
  -- photo never blocks derivation, so it's excluded from both counts —
  -- otherwise a required photo requirement (insertable today; the CHECK
  -- allows it) would leave its stage permanently underivable.
  select count(*) filter (where r.required and r.type <> 'photo'),
         count(*) filter (where r.required and r.type <> 'photo' and resp.id is not null
                            and (r.type <> 'boolean' or resp.value_bool))
    into v_required, v_satisfied
    from public.unit_stages us
    join public.program_stage_requirements r on r.program_stage_id = us.program_stage_id
    left join public.unit_stage_responses resp
      on resp.program_stage_requirement_id = r.id and resp.unit_stage_id = us.id
   where us.id = p_unit_stage_id;

  if v_required is null or v_required = 0 then
    return; -- no required requirements: manual stage, leave it alone
  end if;

  v_done := v_satisfied = v_required;
  update public.unit_stages
     set status = case when v_done then 'done' else 'pending' end,
         done_source = case when v_done then 'requirements' else null end
   where id = p_unit_stage_id
     and (status is distinct from case when v_done then 'done' else 'pending' end
          or done_source is distinct from case when v_done then 'requirements' else null end);
end;
$$;

-- SECURITY DEFINER + an exposed schema means PostgREST would otherwise
-- expose this as POST /rest/v1/rpc/derive_unit_stage — reachable with just
-- the anon key (default EXECUTE for PUBLIC, plus the local default-ACL
-- grant to anon/authenticated), no login, no membership check, free write
-- access to any unit_stage by id. The only legitimate caller is
-- derive_unit_stage_status below, which is unaffected: it runs as the
-- (owner) trigger, and owners always retain access to what they own.
revoke execute on function public.derive_unit_stage(uuid) from public, anon, authenticated, service_role;

create or replace function public.derive_unit_stage_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.derive_unit_stage(coalesce(new.unit_stage_id, old.unit_stage_id));
  -- An upsert-repoint moves an answer between unit_stages: recompute the
  -- one it left as well.
  if tg_op = 'UPDATE' and old.unit_stage_id <> new.unit_stage_id then
    perform public.derive_unit_stage(old.unit_stage_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger unit_stage_responses_derive
after insert or update or delete on public.unit_stage_responses
for each row execute function public.derive_unit_stage_status();

-- ---------- done_source bookkeeping (extends the 0008 done_at trigger)
-- Only derive_unit_stage ever writes done_source explicitly; a status flip
-- arriving WITHOUT one is by definition a staff override. Clients hold no
-- done_source grant, so they cannot fake the 'requirements' provenance.
create or replace function public.maintain_unit_stage_done_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  end if;
  if new.status is distinct from old.status
     and new.done_source is not distinct from old.done_source then
    new.done_source := case when new.status = 'done' then 'override' else null end;
  end if;
  return new;
end;
$$;
-- (trigger unit_stages_done_at from 0008 already calls this function on
-- BEFORE UPDATE OF status — no new trigger needed.)

-- ---------- create_program: copy + expand requirements
-- Body is 0009's create_program with one addition: the requirements insert.
-- The stage CTE maps template stages to their new program stages by the
-- shared re-numbered position.
create or replace function public.create_program(p_template_id uuid, p_name text)
returns public.programs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.templates;
  v_program public.programs;
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

  insert into public.programs (org_id, template_id, name)
  values (v_template.org_id, v_template.id, v_name)
  returning * into v_program;

  with numbered as (
    select ts.id as template_stage_id, ts.name,
           row_number() over (order by ts.position, ts.id) - 1 as pos
      from public.template_stages ts
     where ts.template_id = v_template.id
  ), inserted as (
    insert into public.program_stages (program_id, org_id, name, position)
    select v_program.id, v_template.org_id, n.name, n.pos
      from numbered n
    returning id, position
  )
  -- Requirements: verbatim copy, except checklists explode into one boolean
  -- per config item (label "<checklist> · <item>", config {group}), ordered
  -- by (source position, item order) and re-numbered 0..n-1 per stage.
  insert into public.program_stage_requirements
    (program_stage_id, program_id, org_id, type, label, required, config, position)
  select i.id, v_program.id, v_template.org_id, e.type, e.label, e.required, e.config,
         row_number() over (partition by i.id order by e.src_pos, e.item_ord, e.src_id) - 1
    from numbered n
    join inserted i on i.position = n.pos
    join lateral (
      select r.id as src_id, r.position as src_pos, 0::bigint as item_ord,
             r.type, r.label, r.required, r.config
        from public.template_stage_requirements r
       where r.template_stage_id = n.template_stage_id and r.type <> 'checklist'
      union all
      select r.id, r.position, it.ord, 'boolean',
             r.label || ' · ' || it.item, r.required,
             jsonb_build_object('group', r.label)
        from public.template_stage_requirements r
        cross join lateral jsonb_array_elements_text(r.config->'items')
                   with ordinality as it(item, ord)
       where r.template_stage_id = n.template_stage_id and r.type = 'checklist'
    ) e on true;

  return v_program;
end;
$$;