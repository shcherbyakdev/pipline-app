import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getEntitlements, getOrgSubscription, monthlyBookingUsage } from "@/lib/billing/queries";
import type { Entitlements, OrgSubscriptionRow } from "@/lib/billing/entitlements";
import { env } from "@/env";

export type BillingOverview = {
  orgId: string;
  subscription: OrgSubscriptionRow | null;
  entitlements: Entitlements;
  usage: { bookingsThisMonth: number; activeStaff: number; services: number };
  founderEligible: boolean;
};

/* Everything /billing renders, in one read. RLS client throughout: a member
   selects their own org's subscription, bookings, staff and services.

   Memoised per request (getEntitlementsAdmin idiom) because two callers want
   it on the same render — the dashboard layout's PlanBanner and the page
   itself. Callers pass no argument, so the `now` default is evaluated once
   inside and the cache key is stable. */
export const getBillingOverview = cache(async (now = new Date()): Promise<BillingOverview> => {
  const { org } = await requireOrg();
  const supabase = await createClient();
  const settings = await getSchedulingSettings();
  const [subscription, entitlements, bookingsThisMonth, staffRes, svcRes, orgRow] = await Promise.all([
    getOrgSubscription(org.id, supabase),
    getEntitlements(org.id, supabase, now),
    monthlyBookingUsage(org.id, settings?.timezone ?? "UTC", now, supabase),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle(),
  ]);
  // A failed count would render a meter that quietly reads 0 of 3; throw
  // instead. The layout's banner slot catches (a billing read must never take
  // the dashboard down, spec §7.10); the page shows its error boundary.
  const failed = staffRes.error ?? svcRes.error ?? orgRow.error;
  if (failed) throw failed;
  const founderEligible = Boolean(
    env.BILLING_FOUNDER_PROMO_CODE &&
      env.BILLING_FOUNDER_CUTOFF &&
      orgRow.data?.created_at &&
      Date.parse(orgRow.data.created_at) < Date.parse(`${env.BILLING_FOUNDER_CUTOFF}T00:00:00Z`),
  );
  return {
    orgId: org.id,
    subscription,
    entitlements,
    usage: {
      bookingsThisMonth,
      activeStaff: staffRes.count ?? 0,
      services: svcRes.count ?? 0,
    },
    founderEligible,
  };
});
