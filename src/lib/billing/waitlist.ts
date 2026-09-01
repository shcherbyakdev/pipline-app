// Pure: a premium_waitlist row → the OrgSubscriptionRow it stands in for
// (overrides.ts discipline: no I/O, no clock). The one place "joining the
// waitlist grants Pro" lives; the seam (queries.ts getOrgSubscription) ranks
// it below a comp override and below a live provider row.
import type { OrgSubscriptionRow } from "./entitlements";
import type { PaidPlanId } from "./plans";

export type WaitlistEntry = { joinedAt: string }; // ISO

/** What the waitlist unlocks. Pro, not Team: Team's extra is the roster
    size, and the waitlist is a thank-you, not a seat grant. */
export const WAITLIST_PLAN: PaidPlanId = "pro";

/** Active, monthly (cosmetic — nothing is charged), no period end: the perk
    lasts until the row is removed (/utils) or this seam stops reading it.
    ponytail: flag-agnostic on purpose — when billing goes live, either keep
    honouring early joiners or drop the read in getOrgSubscription; one line. */
export function waitlistRow(entry: WaitlistEntry | null): OrgSubscriptionRow | null {
  if (!entry) return null;
  return { plan: WAITLIST_PLAN, status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false };
}
