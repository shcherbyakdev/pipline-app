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
  it("counts the org's channel against the cap, under its own name", () => {
    expect(resourceMeter(T, { activeStaff: 2, activeUnits: 1 }, APPTS, pro)).toEqual({
      label: "People", value: "2 / 5", caption: "on your booking page", hidden: 0,
    });
  });
  it("a spaces org's backfilled person is not counted, and the tile says Units", () => {
    const m = resourceMeter(T, { activeStaff: 1, activeUnits: 1 }, SPACES, free);
    expect(m.value).toBe("1 / 2");
    expect(m.label).toBe("Units");
  });
  it("over the cap says how many are bookable", () => {
    const m = resourceMeter(T, { activeStaff: 1, activeUnits: 3 }, SPACES, free);
    expect(m.value).toBe("3 / 2");
    expect(m.caption).toBe("only the first 2 are bookable");
    expect(m.hidden).toBe(1);
  });
});

describe("resourceBannerText", () => {
  it("names people or units — never both — and pluralises", () => {
    expect(resourceBannerText(T, APPTS, 1, 2)).toBe("1 person isn't on your booking page — your plan covers 2.");
    expect(resourceBannerText(T, APPTS, 3, 2)).toBe("3 people aren't on your booking page — your plan covers 2.");
    expect(resourceBannerText(T, SPACES, 1, 2)).toBe("1 unit isn't on your booking page — your plan covers 2.");
    expect(resourceBannerText(T, SPACES, 2, 5)).toBe("2 units aren't on your booking page — your plan covers 5.");
  });
});
