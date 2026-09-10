import { describe, expect, it } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import { formatMoney } from "@/lib/money";
import type { OfferingRow } from "./queries";
import {
  bookingSummary,
  durationOptions,
  priceSummary,
  rulesSummary,
  snapToIncrement,
  withCurrent,
} from "./settings-summary";

const t = enTranslator("spaces");
const zl = (cents: number) => formatMoney(cents, "PLN");
const tu = enTranslator("public.units");

const hourly: OfferingRow = {
  id: "o1", name: "Room", description: null, kind: "space", componentIds: [],
  rangeMode: "hours", startTime: null, endTime: null,
  minStay: 1, maxStay: null, turnoverDays: 0, minNoticeDays: 0, bookingWindowDays: 180, unitSelection: "auto",
  slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240, turnoverMin: 0, minNoticeMin: 0,
  active: true, requiresApproval: false, sortOrder: 0, unitCount: 1, activeUnitCount: 1,
  priceCents: 6000, pricingMode: "per_unit", depositType: "none", depositValue: null,
  cancelPolicy: [], termsText: null, pricing: null,
};
const stay: OfferingRow = {
  ...hourly, rangeMode: "nights", startTime: "15:00", endTime: "11:00",
  slotIncrementMin: null, minDurationMin: null, maxDurationMin: null,
  minStay: 2, maxStay: 14, turnoverDays: 1, priceCents: 30000,
};

describe("bookingSummary", () => {
  it("hourly: mode, lengths, step; the gap only when there is one", () => {
    expect(bookingSummary(hourly, t, tu)).toBe("Hourly · 1 h–4 h · every 30 min");
    expect(bookingSummary({ ...hourly, turnoverMin: 15 }, t, tu)).toBe("Hourly · 1 h–4 h · every 30 min · 15 min gap");
  });
  it("stays: check-in/out, then only the limits that are set", () => {
    expect(bookingSummary(stay, t, tu)).toBe(
      "Nightly · check-in 15:00 · check-out 11:00 · min 2 nights · max 14 nights · 1 day gap",
    );
    expect(bookingSummary({ ...stay, minStay: 1, maxStay: null, turnoverDays: 0 }, t, tu)).toBe(
      "Nightly · check-in 15:00 · check-out 11:00",
    );
  });
});

describe("priceSummary", () => {
  it("flat price, or the rules' shape", () => {
    expect(priceSummary(hourly, "PLN", t, tu)).toBe(`${zl(6000)} / hour`);
    expect(priceSummary({ ...hourly, priceCents: null }, "PLN", t, tu)).toBe("Unpriced");
    const rules = {
      bands: [{ fromMin: 60, perHourCents: 5000 }, { fromMin: 240, perHourCents: 4000 }],
      surcharges: [{ label: "Night", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" }],
      extras: [],
      people: { included: 5, extraCents: 1000, max: 10 },
    };
    expect(priceSummary({ ...hourly, pricing: rules }, "PLN", t, tu)).toBe(
      `from ${zl(4000)} / hour · 2 rates by length · 1 surcharge · 5 people included`,
    );
  });
});

describe("rulesSummary", () => {
  it("reads the defaults as one calm line", () => {
    expect(rulesSummary(hourly, "PLN", t, tu)).toBe("No deposit · Free cancellation · up to 180 days ahead");
  });
  it("names every rule that is set", () => {
    const strict: OfferingRow = {
      ...hourly, requiresApproval: true, depositType: "percent", depositValue: 30,
      cancelPolicy: [{ beforeMin: 2880, feePct: 0 }, { beforeMin: 1440, feePct: 50 }],
      minNoticeMin: 120, unitCount: 3, unitSelection: "client_picks", termsText: "No smoking",
    };
    expect(rulesSummary(strict, "PLN", t, tu)).toBe(
      "30% deposit · 2 cancellation tiers · at least 2 hours ahead · up to 180 days ahead · Client picks the unit · Terms attached",
    );
    expect(rulesSummary({ ...hourly, depositType: "fixed", depositValue: 5000 }, "PLN", t, tu)).toContain(`${zl(5000)} deposit`);
    expect(rulesSummary({ ...stay, minNoticeDays: 2 }, "PLN", t, tu)).toContain("at least 2 days ahead");
  });
});

describe("select options", () => {
  it("keeps to the increment's grid and never drops the stored value", () => {
    expect(durationOptions(60, 240)).toEqual([60, 120, 180, 240, 300, 360, 480, 600, 720, 1440]);
    expect(durationOptions(30, 75)).toContain(75);
    expect(withCurrent([0, 15, 30], 20)).toEqual([0, 15, 20, 30]);
  });
  it("snaps up onto the grid, within the day", () => {
    expect(snapToIncrement(75, 30)).toBe(90);
    expect(snapToIncrement(60, 60)).toBe(60);
    expect(snapToIncrement(10, 15)).toBe(15);
    expect(snapToIncrement(1440, 240)).toBe(1440);
  });
});
