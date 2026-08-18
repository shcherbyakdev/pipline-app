// Pure: an org_subscriptions row (or its absence = Free) → what the org may
// do. No clock reads, no I/O — every consumer injects `now`. The one place
// the effective-plan rule lives (spec §7.2); the SQL view billing_mrr
// restates it and says so.
import { PLANS, type Interval, type PaidPlanId, type PlanId, type PlanLimits } from "./plans";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "expired";

export type OrgSubscriptionRow = {
  plan: PaidPlanId;
  status: SubscriptionStatus;
  interval: Interval;
  seats: number;
  currentPeriodEnd: string | null; // ISO
  cancelAtPeriodEnd: boolean;
};

export type Entitlements = PlanLimits & { plan: PlanId };

export function effectivePlan(row: OrgSubscriptionRow | null, now: Date): PlanId {
  if (!row) return "free";
  if (row.status === "active" || row.status === "past_due") return row.plan;
  if (row.status === "cancelled" && row.currentPeriodEnd && Date.parse(row.currentPeriodEnd) > now.getTime()) {
    return row.plan;
  }
  return "free";
}

export function entitlementsFor(row: OrgSubscriptionRow | null, now: Date): Entitlements {
  const plan = effectivePlan(row, now);
  const limits = { ...PLANS[plan].limits };
  if (plan === "team" && row) limits.bookableStaff = Math.max(1, row.seats);
  return { plan, ...limits };
}

/** The org-local calendar month containing `now`, as UTC instants [from, to). */
export function monthWindow(now: Date, timeZone: string): { fromIso: string; toIso: string } {
  const today = dateInZone(now, timeZone); // YYYY-MM-DD
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const first = `${today.slice(0, 7)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return {
    fromIso: wallTimeToUtc(first, "00:00", timeZone).toISOString(),
    toIso: wallTimeToUtc(next, "00:00", timeZone).toISOString(),
  };
}

export function canAddStaff(activeCount: number, ent: Entitlements): boolean {
  return activeCount < ent.bookableStaff;
}

export function canAddService(serviceCount: number, ent: Entitlements): boolean {
  return ent.publicServices === null || serviceCount < ent.publicServices;
}

/** The badge shows unless the org asked to hide it AND the plan allows hiding. */
export function badgeVisible(themeHidePoweredBy: boolean, ent: Entitlements): boolean {
  return !(themeHidePoweredBy && ent.hideBadge);
}

export function reminderQuotaExceeded(usedThisMonth: number, ent: Entitlements): boolean {
  return ent.reminderBookingsPerMonth !== null && usedThisMonth >= ent.reminderBookingsPerMonth;
}
