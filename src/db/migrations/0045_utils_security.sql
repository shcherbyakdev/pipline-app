-- 0045 (Internal utils): CHECKs, RLS, grants for org_plan_overrides +
-- org_feature_flags. Idempotent (drop-if-exists before add), 0043 doctrine.

-- ---------- CHECKs
alter table public.org_plan_overrides drop constraint if exists org_plan_overrides_plan_chk;
alter table public.org_plan_overrides add constraint org_plan_overrides_plan_chk check (plan in ('pro','team'));
-- Mirrors FLAG_KEYS in src/lib/flags — widen here when a flag is added there.
alter table public.org_feature_flags drop constraint if exists org_feature_flags_flag_chk;
alter table public.org_feature_flags add constraint org_feature_flags_flag_chk
  check (flag in ('billing','rentals','overview','command_menu'));

-- ---------- RLS: members read their own org's rows; nobody but service_role writes.
alter table public.org_plan_overrides enable row level security;
drop policy if exists "org_plan_overrides_select_member" on public.org_plan_overrides;
create policy "org_plan_overrides_select_member" on public.org_plan_overrides
  for select to authenticated using (org_id in (select public.user_orgs()));

alter table public.org_feature_flags enable row level security;
drop policy if exists "org_feature_flags_select_member" on public.org_feature_flags;
create policy "org_feature_flags_select_member" on public.org_feature_flags
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies on purpose: written by /utils via service_role only.

-- ---------- Grants (explicit; anon gets nothing)
revoke all on table public.org_plan_overrides from public, anon, authenticated, service_role;
grant select on table public.org_plan_overrides to authenticated;
grant select, insert, update, delete on table public.org_plan_overrides to service_role;
revoke all on table public.org_feature_flags from public, anon, authenticated, service_role;
grant select on table public.org_feature_flags to authenticated;
grant select, insert, update, delete on table public.org_feature_flags to service_role;
