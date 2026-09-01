// Pure: an org_subscriptions row (or its absence = Free) → what the org may
// do. No clock reads, no I/O — every consumer injects `now`. The one place
// the effective-plan rule lives (spec §7.2); the SQL view billing_mrr
// restates it and says so.
import { PLANS, type Interval, type PaidPlanId, type PlanId, type PlanLimits } from "./plans";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import type { OrgMode } from "@/features/orgs/mode";

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

/** Three sources can entitle an org — a comp override, the provider row, the
    premium waitlist — and the seam hands them over in priority order. The
    first one that actually entitles (effectivePlan ≠ free) wins; if none
    does, the first row present is returned so callers keep seeing a lapsed
    provider row rather than nothing. */
export function pickSubscription(rows: ReadonlyArray<OrgSubscriptionRow | null>, now: Date): OrgSubscriptionRow | null {
  return rows.find((r) => r && effectivePlan(r, now) !== "free") ?? rows.find((r) => r !== null) ?? null;
}

export function entitlementsFor(row: OrgSubscriptionRow | null, now: Date): Entitlements {
  const plan = effectivePlan(row, now);
  const limits = { ...PLANS[plan].limits };
  if (plan === "team" && row) limits.bookableResources = Math.max(1, row.seats);
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

/** What the plan's resource budget counts (H5b). */
export type ResourceUsage = { activeStaff: number; activeUnits: number };

/** The one counting rule (spec ruling 5): a person counts only when the org
    offers appointments, a unit only when it offers spaces. Every org has a
    backfilled staff row (0054), so a spaces-only org must not spend its Free
    slot on it. Callers pass the EFFECTIVE mode (rentals flag applied). */
export function countResources(u: ResourceUsage, mode: OrgMode): number {
  return (mode.offersAppointments ? u.activeStaff : 0) + (mode.offersRentals ? u.activeUnits : 0);
}

export function canAddResource(count: number, ent: Entitlements): boolean {
  return count < ent.bookableResources;
}

export function canAddService(serviceCount: number, ent: Entitlements): boolean {
  return ent.publicServices === null || serviceCount < ent.publicServices;
}

/** The badge shows unless the org asked to hide it AND hiding is allowed.
    The whole rule, in one place: the pages pass an entitlement (badgeVisible
    below), emailBadgeUrl passes the flag-off "always allowed", and the embed
    studio passes what the current plan permits — three callers, one answer. */
export function badgeShows(hidePoweredBy: boolean, hideAllowed: boolean): boolean {
  return !(hidePoweredBy && hideAllowed);
}

/** badgeShows for a caller that already holds the org's entitlements. */
export function badgeVisible(themeHidePoweredBy: boolean, ent: Entitlements): boolean {
  return badgeShows(themeHidePoweredBy, ent.hideBadge);
}

export function reminderQuotaExceeded(usedThisMonth: number, ent: Entitlements): boolean {
  return ent.reminderBookingsPerMonth !== null && usedThisMonth >= ent.reminderBookingsPerMonth;
}
