import { describe, it, expect } from "vitest";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { resourceBannerText, resourceMeter } from "./resource-usage";

const now = new Date("2026-08-25T12:00:00Z");
const free = entitlementsFor(null, now);
const pro = entitlementsFor(
  { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  now,
);
const BOTH = { offersAppointments: true, offersRentals: true };
const SPACES = { offersAppointments: false, offersRentals: true };

describe("resourceMeter (spec §1.2)", () => {
  it("counts people and units per channel against the cap", () => {
    expect(resourceMeter({ activeStaff: 1, activeUnits: 1 }, BOTH, pro)).toEqual({
      value: "2 / 3", caption: "people and units on your booking page", hidden: 0,
    });
  });
  it("a spaces-only org's backfilled person is not counted", () => {
    expect(resourceMeter({ activeStaff: 1, activeUnits: 1 }, SPACES, free).value).toBe("1 / 1");
  });
  it("both-mode on Free with spaces explains why they are hidden", () => {
    const m = resourceMeter({ activeStaff: 1, activeUnits: 2 }, BOTH, free);
    expect(m.value).toBe("3 / 1");
    expect(m.caption).toBe("your person takes the slot — spaces need a second resource");
    expect(m.hidden).toBe(2);
  });
  it("over the cap otherwise says how many are public", () => {
    const m = resourceMeter({ activeStaff: 2, activeUnits: 3 }, BOTH, pro);
    expect(m.caption).toBe("only the first 3 are bookable publicly");
    expect(m.hidden).toBe(2);
  });
});

describe("resourceBannerText", () => {
  it("pluralises both numbers", () => {
    expect(resourceBannerText(1, 1)).toBe(
      "Your plan allows 1 bookable resource (people and units); 1 isn't bookable publicly.",
    );
    expect(resourceBannerText(2, 3)).toBe(
      "Your plan allows 3 bookable resources (people and units); 2 aren't bookable publicly.",
    );
  });
});
