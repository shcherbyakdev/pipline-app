-- Custom SQL migration file, put your code below! --

-- Recurrence security model (slice 11):
--   * recur_lead_days CHECKs on both requirement tables (positive, date-only).
--   * unit_stage_response_archive: history — member select ONLY; the definer
--     RPC below is the single writer. anon gets nothing (0013 sweep).
--   * recur_due / recur_rearm: security definer, service_role-execute-only —
--     service_role deliberately holds no direct update grants on unit_stages/
--     unit_stage_responses (the 9254bc4 lesson), so one narrow RPC per verb
--     beats opening column grants on two tables.
--   * create_program: recreated with recur_lead_days joining the snapshot copy.

-- ---------- CHECKs (kept with policies/grants, the 0008 pattern)
alter table public.template_stage_requirements
  add constraint template_stage_requirements_recur_lead_days_check
  check (recur_lead_days is null or (recur_lead_days > 0 and type = 'date'));
alter table public.program_stage_requirements
  add constraint program_stage_requirements_recur_lead_days_check
  check (recur_lead_days is null or (recur_lead_days > 0 and type = 'date'));

-- ---------- archive RLS + grants
alter table public.unit_stage_response_archive enable row level security;

create policy "unit_stage_response_archive_select_member" on public.unit_stage_response_archive
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies: history is written only by recur_rearm
-- (definer, owner postgres) and dies with its unit via FK cascade.

grant select on table public.unit_stage_response_archive to authenticated;
grant select on table public.unit_stage_response_archive to service_role;
revoke insert, update, delete, truncate on table public.unit_stage_response_archive
  from authenticated, service_role;

-- ---------- due-scan RPC. p_today injected so tests can time-travel; the
-- drain passes its own `now`. distinct on (us.id) + min expiry: a stage with
-- several drivers re-arms once, on the earliest date.
create or replace function public.recur_due(p_today date, p_limit int)
returns table (
  unit_stage_id uuid,
  unit_id uuid,
  program_id uuid,
  org_id uuid,
  value_date date,
  recur_lead_days int,
  assigned_participant_id uuid,
  participant_email text
)
language sql
security definer
set search_path = ''
as $$
  select distinct on (us.id)
         us.id, us.unit_id, us.program_id, us.org_id,
         r.value_date, q.recur_lead_days,
         u.assigned_participant_id, p.email
    from public.unit_stage_responses r
    join public.program_stage_requirements q
      on q.id = r.program_stage_requirement_id
     and q.recur_lead_days is not null
    join public.unit_stages us
      on us.id = r.unit_stage_id
     and us.status = 'done'
    join public.units u on u.id = us.unit_id
    left join public.participants p on p.id = u.assigned_participant_id
   where r.type = 'date'
     and r.value_date is not null
     and r.value_date - q.recur_lead_days <= p_today
   order by us.id, r.value_date asc
   limit p_limit;
$$;

revoke execute on function public.recur_due(date, int) from public, anon, authenticated;
grant execute on function public.recur_due(date, int) to service_role;

-- ---------- re-arm RPC: claim + archive + clear + stamp, atomically.
-- The status='done' guard is the claim: a concurrent tick matches zero rows
-- and returns false. Deleting the live rows fires 0015's derive trigger
-- (recomputes 'pending' — already set) and detaches evidence
-- (response_id → null): the previous round's photos survive as history,
-- the new round starts blank.
create or replace function public.recur_rearm(p_unit_stage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due date;
begin
  -- Earliest driver expiry, computed BEFORE the delete removes the rows.
  select min(r.value_date) into v_due
    from public.unit_stage_responses r
    join public.program_stage_requirements q
      on q.id = r.program_stage_requirement_id
     and q.recur_lead_days is not null
   where r.unit_stage_id = p_unit_stage_id
     and r.type = 'date'
     and r.value_date is not null;
  if v_due is null then return false; end if;

  update public.unit_stages
     set status = 'pending', done_source = null, done_at = null,
         due_at = v_due::timestamptz
   where id = p_unit_stage_id and status = 'done';
  if not found then return false; end if;

  insert into public.unit_stage_response_archive
    (id, unit_stage_id, program_stage_requirement_id, unit_id, program_id,
     org_id, type, value_text, value_number, value_bool, value_date,
     answered_by_user_id, answered_by_participant_id, created_at,
     updated_at, superseded_at)
  select id, unit_stage_id, program_stage_requirement_id, unit_id,
         program_id, org_id, type, value_text, value_number, value_bool,
         value_date, answered_by_user_id, answered_by_participant_id,
         created_at, updated_at, now()
    from public.unit_stage_responses
   where unit_stage_id = p_unit_stage_id;

  delete from public.unit_stage_responses where unit_stage_id = p_unit_stage_id;
  return true;
end;
$$;

revoke execute on function public.recur_rearm(uuid) from public, anon, authenticated;
grant execute on function public.recur_rearm(uuid) to service_role;

-- ---------- create_program learns recur_lead_days
-- Recreated VERBATIM from 0011 with recur_lead_days added to the snapshot
-- copy (checklist-expanded booleans get null — they are never drivers).
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
  insert into public.program_stage_requirements
    (program_stage_id, program_id, org_id, type, label, required, config, position, recur_lead_days)
  select i.id, v_program.id, v_template.org_id, e.type, e.label, e.required, e.config,
         row_number() over (partition by i.id order by e.src_pos, e.item_ord, e.src_id) - 1,
         e.recur_lead_days
    from numbered n
    join inserted i on i.position = n.pos
    join lateral (
      select r.id as src_id, r.position as src_pos, 0::bigint as item_ord,
             r.type, r.label, r.required, r.config, r.recur_lead_days
        from public.template_stage_requirements r
       where r.template_stage_id = n.template_stage_id and r.type <> 'checklist'
      union all
      select r.id, r.position, it.ord, 'boolean',
             r.label || ' · ' || it.item, r.required,
             jsonb_build_object('group', r.label), null::int
        from public.template_stage_requirements r
        cross join lateral jsonb_array_elements_text(r.config->'items')
                   with ordinality as it(item, ord)
       where r.template_stage_id = n.template_stage_id and r.type = 'checklist'
    ) e on true;

  return v_program;
end;
$$;
