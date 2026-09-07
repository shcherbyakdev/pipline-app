import { describe, expect, it } from "vitest";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { enTranslator } from "@/i18n/test-translator";

const t = enTranslator("public.units");
import {
  stayUnits, totalCents, depositCents, formatOfferingPrice,
  formatCancelWindow, moneyInfoLines, stayHint,
  quoteHours, sumLines, formatLine, headlinePrice,
  type MoneyFields,
} from "./pricing";
import { FIXTURE_CASES, FIXTURE_RULES, FIXTURE_TZ, FALLBACK_CASES } from "./pricing-fixture";

const base: MoneyFields = { priceCents: 10000, pricingMode: "per_unit", depositType: "none", depositValue: null };

describe("stayUnits", () => {
  it("nights = end - start", () => expect(stayUnits("nights", "2026-09-01", "2026-09-04")).toBe(3));
  it("days are inclusive", () => expect(stayUnits("days", "2026-09-01", "2026-09-04")).toBe(4));
});

describe("totalCents", () => {
  it("per-unit multiplies", () => expect(totalCents(base, 3)).toBe(30000));
  it("fractional hours round to the cent", () =>
    expect(totalCents(base, 90 / 60)).toBe(15000));
  it("uneven fraction rounds half up", () =>
    expect(totalCents({ ...base, priceCents: 9999 }, 100 / 60)).toBe(16665));
  it("flat ignores units", () =>
    expect(totalCents({ ...base, pricingMode: "flat" }, 5)).toBe(10000));
  it("unpriced is null", () => expect(totalCents({ ...base, priceCents: null }, 3)).toBeNull());
});

describe("depositCents", () => {
  it("none → null", () => expect(depositCents(base, 30000)).toBeNull());
  it("full → total", () =>
    expect(depositCents({ ...base, depositType: "full" }, 30000)).toBe(30000));
  it("percent rounds", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 33 }, 10050)).toBe(3317));
  it("fixed caps at total", () =>
    expect(depositCents({ ...base, depositType: "fixed", depositValue: 50000 }, 30000)).toBe(30000));
  it("fixed on an unpriced offering passes through", () =>
    expect(depositCents({ ...base, priceCents: null, depositType: "fixed", depositValue: 20000 }, null)).toBe(20000));
  it("percent with no total → null", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 20 }, null)).toBeNull());
});

describe("formatOfferingPrice", () => {
  it("per-unit names the unit from rangeMode", () => {
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "hours" }, "PLN", t))
      .toBe("120 zł / hour");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "nights" }, "PLN", t))
      .toBe("120 zł / night");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "days" }, "PLN", t))
      .toBe("120 zł / day");
  });
  it("flat is bare", () =>
    expect(formatOfferingPrice({ priceCents: 50000, pricingMode: "flat", rangeMode: "hours" }, "PLN", t))
      .toBe("500 zł"));
  it("unpriced → null", () =>
    expect(formatOfferingPrice({ priceCents: null, pricingMode: "flat", rangeMode: "days" }, "PLN", t)).toBeNull());
});

describe("formatCancelWindow", () => {
  it("whole days say days", () => expect(formatCancelWindow(2880, t)).toBe("2 days"));
  it("one day singular", () => expect(formatCancelWindow(1440, t)).toBe("1 day"));
  it("sub-day says hours", () => expect(formatCancelWindow(90, t)).toBe("1.5 hours"));
  it("one hour singular", () => expect(formatCancelWindow(60, t)).toBe("1 hour"));
});

describe("moneyInfoLines", () => {
  it("emits total, deposit, venue note and policy", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 1440 }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Payment: pay at the venue",
      "Free cancellation until 1 day before start",
    ]);
  });
  it("no money → only the policy line when a window is set", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 120 }, t))
      .toEqual(["Free cancellation until 2 hours before start"]));
  it("nothing set → empty", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 0 }, t)).toEqual([]));
    it("a hold: deposit + pay-now, no venue note", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, holding: true }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Pay 60 zł now to confirm",
    ]));
  it("paid: paid line + balance at the venue", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 1440, paidCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
      "Free cancellation until 1 day before start",
    ]));
  it("paid in full: no balance line", () =>
    expect(moneyInfoLines({ totalCents: 6000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, paidCents: 6000 }, t)).toEqual([
      "Total: 60 zł",
      "Paid: 60 zł",
    ]));
  it("an expired hold: no pay-at-the-venue line", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, settled: true }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
    ]));
  it("cancelled and refunded: no due-at-the-venue line", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, paidCents: 6000, refundedCents: 6000, settled: true }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]));
  it("refunded: the refund line after the money", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, paidCents: 6000, refundedCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]));
});

describe("stayHint", () => {
  it("hourly: the duration range", () => {
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: 60, maxDurationMin: 240 }, t)).toBe("1 h–4 h");
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: 90, maxDurationMin: 150 }, t)).toBe("1 h 30 min–2 h 30 min");
  });

  it("nights/days: the minimum stay when it is more than one", () => {
    expect(stayHint({ rangeMode: "nights", minStay: 2, minDurationMin: null, maxDurationMin: null }, t)).toBe("min 2 nights");
    expect(stayHint({ rangeMode: "days", minStay: 3, minDurationMin: null, maxDurationMin: null }, t)).toBe("min 3 days");
  });
  it("nothing to say: one-night minimum, or an hourly row missing its grid", () => {
    expect(stayHint({ rangeMode: "nights", minStay: 1, minDurationMin: null, maxDurationMin: null }, t)).toBeNull();
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: null, maxDurationMin: null }, t)).toBeNull();
  });
});

const at = (local: string) => {
  const [date, time] = local.split("T");
  return wallTimeToUtc(date, time, FIXTURE_TZ);
};
const offering = { pricing: FIXTURE_RULES, priceCents: null, pricingMode: "per_unit" as const };

describe("quoteHours (TS mirror of rental_quote_hours)", () => {
  for (const c of FIXTURE_CASES) {
    it(c.name, () => {
      if (typeof c.expect === "string") {
        expect(() => quoteHours(offering, at(c.startsLocal), c.durationMin, c.people, c.extras, FIXTURE_TZ)).toThrow(c.expect);
      } else {
        expect(quoteHours(offering, at(c.startsLocal), c.durationMin, c.people, c.extras, FIXTURE_TZ)).toEqual(c.expect);
      }
    });
  }
  for (const c of FALLBACK_CASES) {
    it(`pricing NULL — ${c.name}`, () => {
      const o = { pricing: null, priceCents: c.priceCents, pricingMode: c.pricingMode };
      expect(quoteHours(o, at("2027-03-01T12:00"), c.durationMin, null, [], FIXTURE_TZ)).toEqual(c.expect);
    });
  }
  it("people is ignored when the offering has no people rule", () => {
    const o = { pricing: { ...FIXTURE_RULES, people: undefined }, priceCents: null, pricingMode: "per_unit" as const };
    expect(quoteHours(o, at("2027-03-01T12:00"), 60, 50, [], FIXTURE_TZ)).toEqual([{ kind: "base", qty: 1, unitCents: 14000, cents: 14000 }]);
  });
  it("sumLines adds cents", () => {
    expect(sumLines([{ kind: "base", qty: 1, unitCents: 1, cents: 100 }, { kind: "people", qty: 1, unitCents: 5, cents: 5 }])).toBe(105);
    expect(sumLines([])).toBe(0);
  });
});

describe("formatting", () => {
  it("formatLine renders each kind in the viewer's words with the studio's label", () => {
    expect(formatLine({ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, "PLN", t)).toBe("2 h × 120 zł");
    expect(formatLine({ kind: "base", qty: 1.5, unitCents: null, cents: 19500 }, "PLN", t)).toBe("1 h 30 min");
    expect(formatLine({ kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 }, "PLN", t)).toBe("Noc +25%");
    expect(formatLine({ kind: "people", qty: 2, unitCents: 1000, cents: 2000 }, "PLN", t)).toBe("2 extra people × 10 zł");
    expect(formatLine({ kind: "extra", qty: 2, unitCents: 5000, cents: 15000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" }, "PLN", t)).toBe("ARRI 2 kW × 2");
  });
  it("headlinePrice shows the lowest hourly band with 'from' when rules are set", () => {
    expect(headlinePrice({ ...offering, rangeMode: "hours" }, "PLN", t)).toBe("from 120 zł / hour");
    const totalsOnly = { pricing: { bands: [{ fromMin: 60, totalCents: 19700 }], surcharges: [], extras: [] }, priceCents: null, pricingMode: "per_unit" as const, rangeMode: "hours" as const };
    expect(headlinePrice(totalsOnly, "PLN", t)).toBe("197 zł / 1 h");
    expect(headlinePrice({ pricing: null, priceCents: 12000, pricingMode: "per_unit", rangeMode: "hours" }, "PLN", t)).toBe("120 zł / hour");
  });
  it("moneyInfoLines prints the lines before the total", () => {
    const lines = moneyInfoLines(
      { totalCents: 26000, depositCents: null, currency: "PLN", cancelWindowMin: 0,
        lines: [{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, { kind: "people", qty: 2, unitCents: 1000, cents: 2000 }] },
      t,
    );
    expect(lines).toEqual(["2 h × 120 zł — 240 zł", "2 extra people × 10 zł — 20 zł", "Total: 260 zł", "Payment: pay at the venue"]);
  });
});
