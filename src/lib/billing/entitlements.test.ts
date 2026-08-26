import { describe, it, expect } from "vitest";
import {
  effectivePlan, entitlementsFor, monthWindow, canAddResource, canAddService, countResources,
  badgeShows, badgeVisible, reminderQuotaExceeded, type OrgSubscriptionRow,
} from "./entitlements";

const now = new Date("2026-08-18T12:00:00Z");
const row = (o: Partial<OrgSubscriptionRow>): OrgSubscriptionRow => ({
  plan: "pro", status: "active", interval: "month", seats: 1,
  currentPeriodEnd: "2026-09-18T12:00:00Z", cancelAtPeriodEnd: false, ...o,
});

describe("effectivePlan", () => {
  it("no row → free", () => expect(effectivePlan(null, now)).toBe("free"));
  it("active / past_due → the plan", () => {
    expect(effectivePlan(row({}), now)).toBe("pro");
    expect(effectivePlan(row({ status: "past_due" }), now)).toBe("pro");
  });
  it("cancelled keeps the plan until current_period_end", () => {
    expect(effectivePlan(row({ status: "cancelled" }), now)).toBe("pro");
    expect(effectivePlan(row({ status: "cancelled", currentPeriodEnd: "2026-08-01T00:00:00Z" }), now)).toBe("free");
    expect(effectivePlan(row({ status: "cancelled", currentPeriodEnd: null }), now)).toBe("free");
  });
  it("expired → free", () => expect(effectivePlan(row({ status: "expired" }), now)).toBe("free"));
});

describe("entitlementsFor", () => {
  it("free defaults", () => {
    const e = entitlementsFor(null, now);
    expect(e.plan).toBe("free");
    expect(e.bookableResources).toBe(1);
    expect(e.publicServices).toBe(3);
    expect(e.hideBadge).toBe(false);
  });
  it("team uses seats for bookableResources", () => {
    const e = entitlementsFor(row({ plan: "team", seats: 7 }), now);
    expect(e.plan).toBe("team");
    expect(e.bookableResources).toBe(7);
    expect(e.publicServices).toBeNull();
    expect(e.hideBadge).toBe(true);
  });
});

describe("monthWindow", () => {
  it("is the org-local calendar month as UTC instants (Warsaw, DST month)", () => {
    const w = monthWindow(new Date("2026-10-20T10:00:00Z"), "Europe/Warsaw");
    expect(w.fromIso).toBe("2026-09-30T22:00:00.000Z"); // Oct 1 00:00 CEST
    expect(w.toIso).toBe("2026-10-31T23:00:00.000Z");   // Nov 1 00:00 CET
  });
  it("handles year rollover", () => {
    const w = monthWindow(new Date("2026-12-31T23:30:00Z"), "UTC");
    expect(w.fromIso).toBe("2026-12-01T00:00:00.000Z");
    expect(w.toIso).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("countResources (H5b ruling 5)", () => {
  const BOTH = { offersAppointments: true, offersRentals: true };
  const APPTS = { offersAppointments: true, offersRentals: false };
  const SPACES = { offersAppointments: false, offersRentals: true };
  it("people and units share one budget in a both-mode org", () => {
    expect(countResources({ activeStaff: 2, activeUnits: 3 }, BOTH)).toBe(5);
  });
  it("a spaces-only org's backfilled staff row counts for nothing", () => {
    expect(countResources({ activeStaff: 1, activeUnits: 3 }, SPACES)).toBe(3);
  });
  it("an appointments-only org's units count for nothing", () => {
    expect(countResources({ activeStaff: 2, activeUnits: 3 }, APPTS)).toBe(2);
  });
});

describe("gates", () => {
  const free = entitlementsFor(null, now);
  const team = entitlementsFor(row({ plan: "team", seats: 5 }), now);
  it("canAddResource", () => {
    expect(canAddResource(1, free)).toBe(false);
    expect(canAddResource(0, free)).toBe(true);
    expect(canAddResource(4, team)).toBe(true);
    expect(canAddResource(5, team)).toBe(false);
  });
  it("canAddService", () => {
    expect(canAddService(2, free)).toBe(true);
    expect(canAddService(3, free)).toBe(false);
    expect(canAddService(300, team)).toBe(true);
  });
  it("badgeVisible: hidden only when the org asked AND the plan allows", () => {
    expect(badgeVisible(true, free)).toBe(true);
    expect(badgeVisible(false, team)).toBe(true);
    expect(badgeVisible(true, team)).toBe(false);
    // The same rule for callers holding no Entitlements: emailBadgeUrl's
    // flag-off path and the studio preview.
    expect(badgeShows(true, false)).toBe(true);
    expect(badgeShows(true, true)).toBe(false);
  });
  it("reminderQuotaExceeded", () => {
    expect(reminderQuotaExceeded(29, free)).toBe(false);
    expect(reminderQuotaExceeded(30, free)).toBe(true);
    expect(reminderQuotaExceeded(10_000, team)).toBe(false);
  });
});
