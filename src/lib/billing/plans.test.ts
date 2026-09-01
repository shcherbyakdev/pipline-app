import { describe, it, expect } from "vitest";
import {
  PLANS, PAID_PLANS, TEAM_INCLUDED_RESOURCES, pricePerMonth,
  FOUNDER_PRICE_FACTOR, formatUsd, yearlySaving,
} from "./plans";

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
  it("limits match the H5b spec: resources 1 / 3 / 10, services 3 / ∞ / ∞", () => {
    expect(PLANS.free.limits).toMatchObject({
      bookableResources: 2, publicServices: 3, reminderBookingsPerMonth: 30, hideBadge: false,
    });
    expect(PLANS.pro.limits.bookableResources).toBe(3);
    expect(PLANS.pro.limits.publicServices).toBeNull();
    expect(TEAM_INCLUDED_RESOURCES).toBe(10);
    expect(PLANS.team.limits.bookableResources).toBe(TEAM_INCLUDED_RESOURCES);
  });
  it("blurbs speak of people and units, never seats or team members", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.blurb.toLowerCase()).not.toMatch(/seat|team member/);
    }
    expect(PLANS.free.blurb).toBe("Everything two people — or two rooms — need to take bookings.");
  });
  it("pricePerMonth divides yearly by 12", () => {
    expect(pricePerMonth("pro", "month")).toBe(12);
    expect(pricePerMonth("pro", "year")).toBe(9);
    expect(pricePerMonth("team", "year")).toBe(24);
  });
  it("the Founder factor prices Pro monthly at $8, float noise and all", () => {
    expect(formatUsd(PLANS.pro.monthly * FOUNDER_PRICE_FACTOR)).toBe("$8");
  });
  it("formatUsd keeps whole dollars whole and cents to two places", () => {
    expect(formatUsd(9)).toBe("$9");
    expect(formatUsd(24.5)).toBe("$24.50");
  });
  it("yearlySaving is per plan", () => {
    expect(Math.round(yearlySaving("pro") * 100)).toBe(25);
    expect(Math.round(yearlySaving("team") * 100)).toBe(17);
  });
});
