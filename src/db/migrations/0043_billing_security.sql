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

-- ---------- Webhook projection (spec §7.5): one transaction per event.
-- Idempotent (billing_events unique → 'replayed'), order-safe (conditional
-- upsert on provider_updated_at → 'stale' when strictly older), expires the
-- cache for a resolvable 'subscription_expired' that carries no subscription
-- payload, and records everything else unresolvable without touching the
-- cache ('skipped'). service_role only.
create or replace function public.apply_billing_event(
  p_provider text, p_event_id text, p_occurred_at timestamptz, p_org_id uuid,
  p_type text, p_payload jsonb, p_sub jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.billing_events (provider, provider_event_id, org_id, type, payload, error)
    values (p_provider, p_event_id, p_org_id, p_type, coalesce(p_payload, '{}'::jsonb),
            case when p_org_id is null then 'unresolvable org'
                 when p_sub is null and p_type <> 'subscription_expired' then 'no subscription payload'
                 else null end);
  exception when unique_violation then
    return 'replayed';
  end;
  -- An expiry we can resolve to an org but not to a subscription payload
  -- (Stripe deleted a subscription whose price maps to nothing we know) is
  -- still unambiguous: the org has stopped paying. Expire the cached row
  -- under the SAME ordering guard as the upsert below, rather than dropping
  -- the event and leaving the org paid forever in our cache.
  if p_org_id is not null and p_sub is null and p_type = 'subscription_expired' then
    update public.org_subscriptions s
       set status = 'expired', provider_updated_at = p_occurred_at, updated_at = now()
     where s.org_id = p_org_id and s.provider_updated_at <= p_occurred_at;
    if found then return 'processed'; else return 'stale'; end if;
  end if;
  if p_org_id is null or p_sub is null then
    return 'skipped';
  end if;
  insert into public.org_subscriptions as s (
    org_id, plan, status, billing_interval, seats, provider, provider_customer_id, provider_subscription_id,
    current_period_end, cancel_at_period_end, provider_updated_at, updated_at)
  values (
    p_org_id, p_sub->>'plan', p_sub->>'status', p_sub->>'interval', coalesce((p_sub->>'seats')::int, 1),
    p_provider, p_sub->>'providerCustomerId', p_sub->>'providerSubscriptionId',
    nullif(p_sub->>'currentPeriodEnd','')::timestamptz, coalesce((p_sub->>'cancelAtPeriodEnd')::boolean, false),
    p_occurred_at, now())
  on conflict (org_id) do update set
    plan = excluded.plan, status = excluded.status, billing_interval = excluded.billing_interval,
    seats = excluded.seats, provider = excluded.provider, provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end, provider_updated_at = excluded.provider_updated_at,
    updated_at = now()
  -- `<=`, not `<`: Stripe emits created and updated within the same second
  -- all the time, and a strict `<` would drop the later of the pair as
  -- "stale". A true replay of one event never reaches this line — the
  -- billing_events unique index above already returned 'replayed' — so the
  -- only thing ties can do here is let the last ARRIVAL win, which is what
  -- applyBillingEvents' occurredAt sort already lines up.
  where s.provider_updated_at <= excluded.provider_updated_at;
  if found then return 'processed'; else return 'stale'; end if;
end $$;
revoke all on function public.apply_billing_event(text, text, timestamptz, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_billing_event(text, text, timestamptz, uuid, text, jsonb, jsonb) to service_role;
