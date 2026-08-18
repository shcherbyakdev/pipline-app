// Pure: an org_plan_overrides row → the OrgSubscriptionRow it stands in for.
// No I/O, no clock — `now` is injected (entitlements.ts discipline). The one
// place the "unexpired override wins outright" rule lives (spec §3.4).
import type { OrgSubscriptionRow } from "./entitlements";
import { TEAM_INCLUDED_SEATS, type PaidPlanId } from "./plans";

/* Two shapes, one row. The split mirrors a column-level grant (0046): a
   member may see THAT their org is comped and until when, never the owner's
   internal note or which staffer granted it. Everything the entitlement seam
   needs lives in the narrow shape, so the member-facing read never has to ask
   for a column `authenticated` has no privilege on. */
export type PlanOverride = {
  plan: PaidPlanId;
  expiresAt: string | null; // ISO; null = until revoked
};

/** The whole row, /utils only — read with the ADMIN client (getPlanOverrideDetails). */
export type PlanOverrideDetails = PlanOverride & {
  note: string | null;
  grantedBy: string;
  grantedAt: string; // ISO (updated_at — the last grant/update)
};

export function isOverrideActive(o: PlanOverride | null, now: Date): o is PlanOverride {
  if (!o) return false;
  return o.expiresAt === null || Date.parse(o.expiresAt) > now.getTime();
}

/** The synthetic subscription an active comp behaves as: active, monthly (no
    price is charged, so the interval is cosmetic), the Team seat count (a
    comped Team org gets the full roster; a comped Pro org's limit is 1
    anyway — entitlementsFor only reads seats for Team), never cancelling,
    ending when the comp expires. */
export function activeOverrideRow(o: PlanOverride | null, now: Date): OrgSubscriptionRow | null {
  if (!isOverrideActive(o, now)) return null;
  return {
    plan: o.plan,
    status: "active",
    interval: "month",
    seats: TEAM_INCLUDED_SEATS,
    currentPeriodEnd: o.expiresAt,
    cancelAtPeriodEnd: false,
  };
}
