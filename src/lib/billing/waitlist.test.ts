import { describe, it, expect } from "vitest";
import { waitlistRow, WAITLIST_PLAN } from "./waitlist";
import { entitlementsFor } from "./entitlements";

const now = new Date("2026-09-01T12:00:00Z");

describe("waitlistRow", () => {
  it("null → null", () => expect(waitlistRow(null)).toBeNull());
  it("a row → an active Pro subscription with no period end", () => {
    const row = waitlistRow({ joinedAt: "2026-09-01T00:00:00Z" });
    expect(row).toMatchObject({ plan: WAITLIST_PLAN, status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false });
    const ent = entitlementsFor(row, now);
    expect(ent.plan).toBe("pro");
    expect(ent.hideBadge).toBe(true);
    expect(ent.reminderBookingsPerMonth).toBeNull();
  });
});
