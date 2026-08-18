import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FakeRow } from "@/lib/billing/fake-emulator";
import type { Interval } from "@/lib/billing/plans";
import { isPaidPlan } from "@/lib/billing/plans";
import type { SubscriptionStatus } from "@/lib/billing/entitlements";

/* `getOrgSubscription`'s read (src/lib/billing/queries.ts) plus the provider
   ids. The emulator needs them: every action event echoes the row back to the
   provider seam, and `providerCustomerId`/`providerSubscriptionId` are what
   tie the new event to the subscription already cached (an event that
   invented fresh ids would trip the provider_subscription_id unique index,
   0042). Kept out of src/lib/billing/queries.ts because nothing in the app
   proper should be handed provider ids it has no business quoting — only the
   dev portal displays them.

   Both the portal page and the portal actions read through here, so "what a
   FakeRow is" is stated once. */
const FAKE_ROW_COLS =
  "plan, status, billing_interval, seats, current_period_end, cancel_at_period_end, provider_customer_id, provider_subscription_id";

/** The org's subscription as the emulator sees it, or null for "Free" —
    no row, or a row whose plan isn't one we sell any more. Takes the ADMIN
    client (the dev pages already resolved the org through requireDevBilling). */
export async function readFakeRow(admin: SupabaseClient, orgId: string): Promise<FakeRow | null> {
  const { data, error } = await admin
    .from("org_subscriptions")
    .select(FAKE_ROW_COLS)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !isPaidPlan(data.plan)) return null;
  return {
    plan: data.plan,
    status: data.status as SubscriptionStatus,
    interval: data.billing_interval as Interval,
    seats: data.seats,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    providerCustomerId: data.provider_customer_id,
    providerSubscriptionId: data.provider_subscription_id,
  };
}
