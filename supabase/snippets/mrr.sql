-- Founder MRR (run in Supabase Studio as service_role). Mirrors src/lib/billing/plans.ts.
select plan, billing_interval, subscriptions, seats, mrr_usd from public.billing_mrr order by plan, billing_interval;
select sum(mrr_usd) as total_mrr_usd, sum(subscriptions) as paying_orgs from public.billing_mrr;
