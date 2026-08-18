-- 0043 (Billing): CHECKs, RLS, grants for org_subscriptions + billing_events,
-- the (org_id, created_at) bookings index behind the monthly usage count, and
-- the founder's MRR view. Written idempotently (drop-if-exists before add).

-- ---------- CHECKs
alter table public.org_subscriptions drop constraint if exists org_subscriptions_plan_chk;
alter table public.org_subscriptions add constraint org_subscriptions_plan_chk check (plan in ('pro','team'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_status_chk;
alter table public.org_subscriptions add constraint org_subscriptions_status_chk
  check (status in ('active','past_due','cancelled','expired'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_interval_chk;
alter table public.org_subscriptions add constraint org_subscriptions_interval_chk check (billing_interval in ('month','year'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_seats_chk;
alter table public.org_subscriptions add constraint org_subscriptions_seats_chk check (seats >= 1);
alter table public.org_subscriptions drop constraint if exists org_subscriptions_provider_chk;
alter table public.org_subscriptions add constraint org_subscriptions_provider_chk check (provider in ('stripe','fake'));

-- ---------- RLS: members read their own row; nobody but service_role writes.
alter table public.org_subscriptions enable row level security;
drop policy if exists "org_subscriptions_select_member" on public.org_subscriptions;
create policy "org_subscriptions_select_member" on public.org_subscriptions
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies on purpose (spec §4.4: webhook-written cache)

alter table public.billing_events enable row level security;
-- no policies at all: service_role bypasses RLS, everyone else has no grant.

-- ---------- Grants (0004 doctrine: explicit, anon gets nothing)
revoke all on table public.org_subscriptions from public, anon, authenticated, service_role;
grant select on table public.org_subscriptions to authenticated;
grant select, insert, update, delete on table public.org_subscriptions to service_role;
revoke all on table public.billing_events from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_events to service_role;

-- ---------- Monthly usage count (spec §7.3): bookings made this month per org.
create index if not exists bookings_org_created_at_idx on public.bookings (org_id, created_at);

-- ---------- Founder's MRR view. Prices MIRROR src/lib/billing/plans.ts — keep both in step.
-- Effective-plan rule mirrors entitlements.ts: active/past_due, or cancelled until period end.
drop view if exists public.billing_mrr;
create view public.billing_mrr with (security_invoker = true) as
select plan,
       billing_interval,
       count(*)::int as subscriptions,
       sum(seats)::int as seats,
       sum(case
             when plan = 'pro'  and billing_interval = 'month' then 12
             when plan = 'pro'  and billing_interval = 'year'  then 9
             when plan = 'team' and billing_interval = 'month' then 29
             else 24
           end)::numeric as mrr_usd
from public.org_subscriptions
where status in ('active','past_due')
   or (status = 'cancelled' and current_period_end > now())
group by plan, billing_interval;
revoke all on public.billing_mrr from public, anon, authenticated, service_role;
grant select on public.billing_mrr to service_role;
