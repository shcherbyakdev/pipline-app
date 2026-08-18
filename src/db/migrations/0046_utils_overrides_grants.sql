-- 0046 (Internal utils): members may see THAT they have a comp and until when,
-- never the owner's note or who granted it. Column-level grant replaces the
-- table-wide one from 0045. Idempotent.
revoke select on table public.org_plan_overrides from authenticated;
grant select (org_id, plan, expires_at) on table public.org_plan_overrides to authenticated;
