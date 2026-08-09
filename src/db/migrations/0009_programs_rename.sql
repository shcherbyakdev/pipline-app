-- Custom SQL migration file, put your code below! --

-- Slice 5a: rollout → program. Pure renames (data-preserving) plus
-- recreation of the three functions whose SQL text names the old tables.
-- Policies, grants, and trigger column lists survive renames (they bind by
-- OID/attnum); function BODIES are text and do not — hence the recreates.
-- Safe as a single release: deploys are disabled, app is local-only.

-- Tables
ALTER TABLE "rollouts" RENAME TO "programs";
ALTER TABLE "rollout_stages" RENAME TO "program_stages";

-- Columns
ALTER TABLE "program_stages" RENAME COLUMN "rollout_id" TO "program_id";
ALTER TABLE "units" RENAME COLUMN "rollout_id" TO "program_id";
ALTER TABLE "unit_stages" RENAME COLUMN "rollout_stage_id" TO "program_stage_id";
ALTER TABLE "unit_stages" RENAME COLUMN "rollout_id" TO "program_id";

-- Constraints (pkeys, then FKs) — names must match what drizzle-kit would
-- generate for the new schema, or the drift gate fails.
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_pkey" TO "programs_pkey";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_pkey" TO "program_stages_pkey";
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_org_id_orgs_id_fk" TO "programs_org_id_orgs_id_fk";
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_template_id_templates_id_fk" TO "programs_template_id_templates_id_fk";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_rollout_id_rollouts_id_fk" TO "program_stages_program_id_programs_id_fk";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_org_id_orgs_id_fk" TO "program_stages_org_id_orgs_id_fk";
ALTER TABLE "units" RENAME CONSTRAINT "units_rollout_id_rollouts_id_fk" TO "units_program_id_programs_id_fk";
ALTER TABLE "unit_stages" RENAME CONSTRAINT "unit_stages_rollout_stage_id_rollout_stages_id_fk" TO "unit_stages_program_stage_id_program_stages_id_fk";
ALTER TABLE "unit_stages" RENAME CONSTRAINT "unit_stages_rollout_id_rollouts_id_fk" TO "unit_stages_program_id_programs_id_fk";
-- unit_stages_unit_stage_uq is noun-free and keeps its name.

-- Indexes
ALTER INDEX "rollouts_org_id_idx" RENAME TO "programs_org_id_idx";
ALTER INDEX "rollouts_template_id_idx" RENAME TO "programs_template_id_idx";
ALTER INDEX "rollout_stages_rollout_id_idx" RENAME TO "program_stages_program_id_idx";
ALTER INDEX "rollout_stages_org_id_idx" RENAME TO "program_stages_org_id_idx";
ALTER INDEX "units_rollout_id_idx" RENAME TO "units_program_id_idx";
ALTER INDEX "unit_stages_rollout_stage_id_idx" RENAME TO "unit_stages_program_stage_id_idx";
ALTER INDEX "unit_stages_rollout_id_idx" RENAME TO "unit_stages_program_id_idx";

-- Policies (cosmetic rename; expressions bind by attnum and survive)
ALTER POLICY "rollouts_select_member" ON "programs" RENAME TO "programs_select_member";
ALTER POLICY "rollouts_update_member" ON "programs" RENAME TO "programs_update_member";
ALTER POLICY "rollouts_delete_member" ON "programs" RENAME TO "programs_delete_member";
ALTER POLICY "rollout_stages_select_member" ON "program_stages" RENAME TO "program_stages_select_member";

-- check_unit_org: body referenced public.rollouts / new.rollout_id.
-- Same trigger (units_check_org) keeps firing it; only the body changes.
create or replace function public.check_unit_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program_org uuid;
begin
  select org_id into v_program_org
    from public.programs
   where id = new.program_id;
  if v_program_org is null then
    raise exception 'program not found';
  end if;
  if v_program_org <> new.org_id then
    raise exception 'org mismatch';
  end if;
  return new;
end;
$$;

-- copy_stages_to_unit: body referenced rollout_stages / rollout_id.
create or replace function public.copy_stages_to_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.unit_stages (unit_id, program_stage_id, program_id, org_id)
  select new.id, ps.id, new.program_id, new.org_id
    from public.program_stages ps
   where ps.program_id = new.program_id;
  return new;
end;
$$;

-- The RPC changes NAME, so drop-and-create (grants die with the drop).
-- Body is 0006's create_rollout with the nouns renamed; checks unchanged.
DROP FUNCTION public.create_rollout(uuid, text);

create function public.create_program(p_template_id uuid, p_name text)
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

  insert into public.program_stages (program_id, org_id, name, position)
  select v_program.id, v_template.org_id, ts.name,
         row_number() over (order by ts.position, ts.id) - 1
    from public.template_stages ts
   where ts.template_id = v_template.id;

  return v_program;
end;
$$;

grant execute on function public.create_program(uuid, text) to authenticated;
