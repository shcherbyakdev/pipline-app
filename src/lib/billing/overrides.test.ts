import { describe, it, expect } from "vitest";
import { activeOverrideRow, type PlanOverride } from "./overrides";
import { TEAM_INCLUDED_RESOURCES } from "./plans";

const now = new Date("2026-08-18T12:00:00Z");
// The narrow shape: plan + expiry is all the seam reads, and all a member is
// granted (0046). The note/grantor columns live on PlanOverrideDetails.
const ovr = (o: Partial<PlanOverride> = {}): PlanOverride => ({ plan: "pro", expiresAt: null, ...o });

describe("activeOverrideRow", () => {
  it("null → null", () => expect(activeOverrideRow(null, now)).toBeNull());
  it("no expiry → an active row with the comped plan, Team seat count, no cancellation", () => {
    expect(activeOverrideRow(ovr(), now)).toEqual({
      plan: "pro", status: "active", interval: "month", seats: TEAM_INCLUDED_RESOURCES,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
    });
  });
  it("future expiry → active, and the expiry is the period end", () => {
    const row = activeOverrideRow(ovr({ plan: "team", expiresAt: "2026-09-01T00:00:00Z" }), now);
    expect(row?.plan).toBe("team");
    expect(row?.currentPeriodEnd).toBe("2026-09-01T00:00:00Z");
  });
  it("expiry at or before now → null (the real row takes over)", () => {
    expect(activeOverrideRow(ovr({ expiresAt: "2026-08-18T12:00:00Z" }), now)).toBeNull();
    expect(activeOverrideRow(ovr({ expiresAt: "2026-01-01T00:00:00Z" }), now)).toBeNull();
  });
});
