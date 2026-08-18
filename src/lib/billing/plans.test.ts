import { describe, it, expect } from "vitest";
import { PLANS, PAID_PLANS, TEAM_INCLUDED_SEATS, pricePerMonth } from "./plans";

describe("PLANS", () => {
  it("has free, pro, team with the spec prices", () => {
    expect(PLANS.free.monthly).toBe(0);
    expect(PLANS.pro.monthly).toBe(12);
    expect(PLANS.pro.yearly).toBe(108);
    expect(PLANS.team.monthly).toBe(29);
    expect(PLANS.team.yearly).toBe(288);
  });
  it("yearly is cheaper than 12× monthly for paid plans", () => {
    for (const id of PAID_PLANS) expect(PLANS[id].yearly).toBeLessThan(PLANS[id].monthly * 12);
  });
  it("free limits match the spec", () => {
    expect(PLANS.free.limits).toMatchObject({
      bookableStaff: 1, publicServices: 3, reminderBookingsPerMonth: 30, hideBadge: false,
    });
    expect(PLANS.pro.limits.publicServices).toBeNull();
    expect(PLANS.team.limits.bookableStaff).toBe(TEAM_INCLUDED_SEATS);
  });
  it("pricePerMonth divides yearly by 12", () => {
    expect(pricePerMonth("pro", "month")).toBe(12);
    expect(pricePerMonth("pro", "year")).toBe(9);
    expect(pricePerMonth("team", "year")).toBe(24);
  });
});
