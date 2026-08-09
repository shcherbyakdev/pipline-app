-- Custom SQL migration file, put your code below! --

-- Unit progress security model:
--   * unit_stages rows are SYSTEM-MANAGED: created only by the units
--     AFTER INSERT fan-out trigger (SECURITY DEFINER — API roles hold no
--     insert grant), removed only by cascades. Members hold select + a
--     column-scoped update (status); done_at is trigger-maintained.
--   * rider: units update grant narrowed to (name, external_ref) so a
--     repointed rollout_id can never orphan fanned-out rows.
-- Grants are explicit per table (0004 convention).

alter table public.unit_stages enable row level security;

create policy "unit_stages_select_member" on public.unit_stages
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "unit_stages_update_member" on public.unit_stages
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));

grant select on table public.unit_stages to authenticated;
grant update (status) on table public.unit_stages to authenticated;
-- service_role: select only (the rollout_stages precedent — nothing in the
-- API writes this table; the definer trigger and cascades are the writers).
grant select on table public.unit_stages to service_role;

alter table public.unit_stages
  add constraint unit_stages_status_check check (status in ('pending', 'done'));

-- Rider: nothing in the product moves a unit between rollouts/orgs, and a
-- repointed rollout_id would orphan the fan-out. Close it at the grant layer
-- (same move as the rollouts (name, updated_at) scope). units_check_org
-- stays: it still guards insert and service_role updates.
revoke update on table public.units from authenticated;
grant update (name, external_ref) on table public.units to authenticated;

-- Fan-out: every new unit gets one pending row per stage of its rollout.
-- SECURITY DEFINER because API roles hold no insert grant on unit_stages
-- (the create_rollout reasoning). Pure derivation — no user input, no
-- raises; org/rollout consistency of NEW is already guaranteed by
-- units_check_org, so every derived row is consistent by construction.
create or replace function public.copy_stages_to_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.unit_stages (unit_id, rollout_stage_id, rollout_id, org_id)
  select new.id, rs.id, new.rollout_id, new.org_id
    from public.rollout_stages rs
   where rs.rollout_id = new.rollout_id;
  return new;
end;
$$;

create trigger units_copy_stages
after insert on public.units
for each row execute function public.copy_stages_to_unit();

-- done_at follows status transitions; clients cannot write it (no column
-- grant), so this trigger is its only writer. Runs as invoker — it only
-- shapes NEW.
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
  return new;
end;
$$;

create trigger unit_stages_done_at
before update of status on public.unit_stages
for each row execute function public.maintain_unit_stage_done_at();

-- Backfill pre-feature units (runs as migration owner; grants/RLS exempt).
insert into public.unit_stages (unit_id, rollout_stage_id, rollout_id, org_id)
select u.id, rs.id, u.rollout_id, u.org_id
  from public.units u
  join public.rollout_stages rs on rs.rollout_id = u.rollout_id
on conflict (unit_id, rollout_stage_id) do nothing;
