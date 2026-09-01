import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getRawOrgSubscription, getPlanOverride, getWaitlistEntry, monthlyBookingUsage } from "@/lib/billing/queries";
import { activeOverrideRow, type PlanOverride } from "@/lib/billing/overrides";
import { waitlistRow, type WaitlistEntry } from "@/lib/billing/waitlist";
import {
  entitlementsFor,
  pickSubscription,
  type Entitlements,
  type OrgSubscriptionRow,
} from "@/lib/billing/entitlements";
import type { PlanId } from "@/lib/billing/plans";
import { effectiveMode, modeOf, type OrgMode } from "@/features/orgs/mode";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { isFounderEligible } from "./founder";

export type BillingOverview = {
  orgId: string;
  subscription: OrgSubscriptionRow | null;
  override: PlanOverride | null;
  waitlist: WaitlistEntry | null;
  entitlements: Entitlements;
  /** The org's channels with the rentals kill-switch applied — what
      countResources should count (H5b ruling 5). */
  mode: OrgMode;
  usage: { bookingsThisMonth: number; activeStaff: number; activeUnits: number; services: number };
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
  const [settings, subscription, override, waitlist, flags, staffRes, unitRes, svcRes, orgRow] = await Promise.all([
    getSchedulingSettings(),
    getRawOrgSubscription(org.id, supabase),
    getPlanOverride(org.id, supabase),
    getWaitlistEntry(org.id, supabase),
    getDashboardFlags(org.id),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("rental_units").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle(),
  ]);
  // A failed count would render a meter that quietly reads 0 of 3; throw
  // instead. The layout's banner slot catches it (a billing read must never
  // take the dashboard down, spec §7.10); on /billing the failure surfaces.
  const failed = staffRes.error ?? unitRes.error ?? svcRes.error ?? orgRow.error;
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
    waitlist,
    // Comp > provider row > waitlist (lib/billing/queries.ts#getOrgSubscription).
    entitlements: entitlementsFor(pickSubscription([activeOverrideRow(override, now), subscription, waitlistRow(waitlist)], now), now),
    mode: effectiveMode(flags, modeOf(org)),
    usage: {
      bookingsThisMonth,
      activeStaff: staffRes.count ?? 0,
      activeUnits: unitRes.count ?? 0,
      services: svcRes.count ?? 0,
    },
    founderEligible: isFounderEligible(orgRow.data?.created_at),
  };
});

export type PlanStatus = { plan: PlanId; waitlisted: boolean };

/** What the shell shows on every page — the plan tag and the waitlist card —
    so it is the cheapest read that answers both: the three seam rows, no
    counts. Per-request memoised; DEGRADES to Free/not-joined on failure (a
    tag must never take the dashboard down, spec §7.10). */
export const getPlanStatus = cache(async (now = new Date()): Promise<PlanStatus> => {
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const [subscription, override, waitlist] = await Promise.all([
      getRawOrgSubscription(org.id, supabase),
      getPlanOverride(org.id, supabase),
      getWaitlistEntry(org.id, supabase),
    ]);
    const row = pickSubscription([activeOverrideRow(override, now), subscription, waitlistRow(waitlist)], now);
    return { plan: entitlementsFor(row, now).plan, waitlisted: waitlist !== null };
  } catch (error) {
    console.error("[billing] plan status read failed (showing Free):", error);
    return { plan: "free", waitlisted: false };
  }
});
