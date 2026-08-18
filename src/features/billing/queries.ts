import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getRawOrgSubscription, getPlanOverride, monthlyBookingUsage } from "@/lib/billing/queries";
import { activeOverrideRow, type PlanOverride } from "@/lib/billing/overrides";
import {
  entitlementsFor,
  type Entitlements,
  type OrgSubscriptionRow,
} from "@/lib/billing/entitlements";
import { isFounderEligible } from "./founder";

export type BillingOverview = {
  orgId: string;
  subscription: OrgSubscriptionRow | null;
  override: PlanOverride | null;
  entitlements: Entitlements;
  usage: { bookingsThisMonth: number; activeStaff: number; services: number };
  founderEligible: boolean;
};

/* Everything /billing renders, in one read. RLS client throughout: a member
   selects their own org's subscription, bookings, staff and services.

   The provider row and the comp override are fetched once and the
   entitlements derived from them (entitlementsFor is pure) — getEntitlements
   would re-read the same rows.

   Memoised per request (getEntitlementsAdmin idiom) because two callers want
   it on the same render — the dashboard layout's PlanBanner and the page
   itself. Callers pass no argument, so the `now` default is evaluated once
   inside and the cache key is stable. */
export const getBillingOverview = cache(async (now = new Date()): Promise<BillingOverview> => {
  const { org } = await requireOrg();
  const supabase = await createClient();
  const [settings, subscription, override, staffRes, svcRes, orgRow] = await Promise.all([
    getSchedulingSettings(),
    getRawOrgSubscription(org.id, supabase),
    getPlanOverride(org.id, supabase),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle(),
  ]);
  // A failed count would render a meter that quietly reads 0 of 3; throw
  // instead. The layout's banner slot catches it (a billing read must never
  // take the dashboard down, spec §7.10); on /billing the failure surfaces.
  const failed = staffRes.error ?? svcRes.error ?? orgRow.error;
  if (failed) throw failed;
  // Needs the org timezone, so it can't join the batch above.
  const bookingsThisMonth = await monthlyBookingUsage(
    org.id,
    settings?.timezone ?? "UTC",
    now,
    supabase,
  );

  return {
    orgId: org.id,
    subscription,
    override,
    // A live comp beats the provider row (lib/billing/queries.ts#getOrgSubscription).
    entitlements: entitlementsFor(activeOverrideRow(override, now) ?? subscription, now),
    usage: {
      bookingsThisMonth,
      activeStaff: staffRes.count ?? 0,
      services: svcRes.count ?? 0,
    },
    founderEligible: isFounderEligible(orgRow.data?.created_at),
  };
});
