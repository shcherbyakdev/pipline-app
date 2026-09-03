import { describe, it, expect } from "vitest";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { enTranslator } from "@/i18n/test-translator";
import { resourceBannerText, resourceMeter } from "./resource-usage";

const T = enTranslator("billing");
const now = new Date("2026-08-25T12:00:00Z");
const free = entitlementsFor(null, now);
const pro = entitlementsFor(
  { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  now,
);
const APPTS = { offersAppointments: true, offersRentals: false };
const SPACES = { offersAppointments: false, offersRentals: true };

describe("resourceMeter (spec §1.2)", () => {
  it("counts the org's channel against the cap", () => {
    expect(resourceMeter(T, { activeStaff: 2, activeUnits: 1 }, APPTS, pro)).toEqual({
      value: "2 / 5", caption: "people and units on your booking page", hidden: 0,
    });
  });
  it("a spaces org's backfilled person is not counted", () => {
    expect(resourceMeter(T, { activeStaff: 1, activeUnits: 1 }, SPACES, free).value).toBe("1 / 2");
  });
  it("over the cap says how many are public", () => {
    const m = resourceMeter(T, { activeStaff: 1, activeUnits: 3 }, SPACES, free);
    expect(m.value).toBe("3 / 2");
    expect(m.caption).toBe("only the first 2 are bookable publicly");
    expect(m.hidden).toBe(1);
  });
});

describe("resourceBannerText", () => {
  it("pluralises both numbers", () => {
    expect(resourceBannerText(T, 1, 1)).toBe(
      "Your plan allows 1 bookable resource (people and units); 1 isn't bookable publicly.",
    );
    expect(resourceBannerText(T, 2, 3)).toBe(
      "Your plan allows 3 bookable resources (people and units); 2 aren't bookable publicly.",
    );
  });
});
