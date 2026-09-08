import { describe, expect, it } from "vitest";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { enTranslator } from "@/i18n/test-translator";

const t = enTranslator("public.units");
import {
  stayUnits, totalCents, depositCents, formatOfferingPrice,
  formatCancelWindow, moneyInfoLines, changeLines, stayHint,
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
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: [{ beforeMin: 1440, feePct: 0 }] }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Payment: pay at the venue",
      "Free cancellation until 1 day before start · 100% after that",
    ]);
  });
  it("no money → only the policy line when a window is set", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelPolicy: [{ beforeMin: 120, feePct: 0 }] }, t))
      .toEqual(["Free cancellation until 2 hours before start · 100% after that"]));
  it("nothing set → empty", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelPolicy: null }, t)).toEqual([]));
    it("a hold: deposit + pay-now, no venue note", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, holding: true }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Pay 60 zł now to confirm",
    ]));
  it("paid: paid line + balance at the venue", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: [{ beforeMin: 1440, feePct: 0 }], paidCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
      "Free cancellation until 1 day before start · 100% after that",
    ]));
  it("paid in full: no balance line", () =>
    expect(moneyInfoLines({ totalCents: 6000, depositCents: 6000, currency: "PLN", cancelPolicy: null, paidCents: 6000 }, t)).toEqual([
      "Total: 60 zł",
      "Paid: 60 zł",
    ]));
  it("an expired hold with nothing paid: only the total line", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, settled: true }, t)).toEqual([
      "Total: 300 zł",
    ]));
  it("cancelled and refunded: no due-at-the-venue line", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, paidCents: 6000, refundedCents: 6000, settled: true }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]));
  it("refunded: the refund line after the money; the venue is owed what is no longer held", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, paidCents: 6000, refundedCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "300 zł due at the venue",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]));
  // Two moves: 300 paid, 200 already handed back on the first move — the
  // venue is owed against the 100 still held, not the 300 gross.
  it("a second move: the balance counts only the money still held", () =>
    expect(moneyInfoLines({ totalCents: 25000, depositCents: 6000, currency: "PLN", cancelPolicy: null, feeCents: 0, paidCents: 30000, refundedCents: 20000 }, t))
      .toContain("150 zł due at the venue"));
  it("a fee on a live row with nothing paid: total, fee, deposit due, venue note", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: null, feeCents: 15000, paidCents: 0 }, t)).toEqual([
      "Total: 300 zł",
      "Late change fee: 150 zł",
      "Deposit due: 90 zł",
      "Payment: pay at the venue",
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
      { totalCents: 26000, depositCents: null, currency: "PLN", cancelPolicy: null,
        lines: [{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, { kind: "people", qty: 2, unitCents: 1000, cents: 2000 }] },
      t,
    );
    expect(lines).toEqual(["2 h × 120 zł — 240 zł", "2 extra people × 10 zł — 20 zł", "Total: 260 zł", "Payment: pay at the venue"]);
  });
});

describe("moneyInfoLines — S3 fee", () => {
  const P = [{ beforeMin: 4320, feePct: 0 }, { beforeMin: 2880, feePct: 50 }];
  it("a live row with a change fee: fee after the total, balance counts it", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 15000, paidCents: 9000 }, t)).toEqual([
      "Total: 300 zł",
      "Late change fee: 150 zł",
      "Paid: 90 zł",
      "360 zł due at the venue",
      "Free cancellation until 3 days before start · 50% fee until 2 days before · 100% after that",
    ]);
  });
  it("a cancelled row: cancellation fee, refund, no venue line, no policy line", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 15000, paidCents: 9000, refundedCents: 0, settled: true }, t)).toEqual([
      "Total: 300 zł",
      "Cancellation fee: 150 zł",
      "Paid: 90 zł",
    ]);
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 3000, paidCents: 9000, refundedCents: 6000, settled: true }, t)).toEqual([
      "Total: 300 zł",
      "Cancellation fee: 30 zł",
      "Paid: 90 zł",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]);
  });
  it("fee 0 renders byte-identical to S2", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, feeCents: 0, paidCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
    ]);
  });
});

describe("moneyInfoLines — S7 charges", () => {
  it("charge lines after the fee; balance counts them; online wording", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: null, paidCents: 9000,
      charges: [{ label: "Overtime", qty: 2, cents: 10000 }, { label: "Cleaning", qty: 1, cents: 15000 }], onlinePay: true }, t)).toEqual([
      "Total: 300 zł", "Overtime × 2 — 100 zł", "Cleaning — 150 zł", "Paid: 90 zł", "460 zł due — pay online or at the venue",
    ]);
  });
  it("write-off drops the balance and prints; unpaid booking with charges shows the balance instead of pay-at-venue", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: null, currency: "PLN", cancelPolicy: null, paidCents: 30000,
      charges: [{ label: "Damage", qty: 1, cents: 20000 }], writtenOffCents: 20000 }, t)).toEqual([
      "Total: 300 zł", "Damage — 200 zł", "Paid: 300 zł", "Written off: 200 zł",
    ]);
    expect(moneyInfoLines({ totalCents: 30000, depositCents: null, currency: "PLN", cancelPolicy: null,
      charges: [{ label: "Cleaning", qty: 1, cents: 15000 }] }, t)).toEqual([
      "Total: 300 zł", "Cleaning — 150 zł", "450 zł due at the venue",
    ]);
  });
});

describe("changeLines", () => {
  const base = { currency: "PLN", priorFeeCents: 0, paidCents: 9000, refundedCents: 0 };
  it("cheaper slot inside a tier: new total, fee, refund of the excess", () => {
    expect(changeLines({ ...base, newTotalCents: 2000, feeCents: 5000, feePct: 50 }, t)).toEqual([
      "New total: 20 zł",
      "Late change fee: 50 zł (50%)",
      "20 zł will be refunded",
    ]);
  });
  it("dearer slot in the free tier: new total and the balance", () => {
    expect(changeLines({ ...base, newTotalCents: 40000, feeCents: 0, feePct: 0 }, t)).toEqual([
      "New total: 400 zł",
      "310 zł due at the venue",
    ]);
  });
  it("exactly settled says nothing beyond the total; a prior fee counts; unpriced says nothing", () => {
    expect(changeLines({ ...base, newTotalCents: 9000, feeCents: 0, feePct: 0 }, t)).toEqual(["New total: 90 zł"]);
    expect(changeLines({ ...base, newTotalCents: 5000, priorFeeCents: 4000, feeCents: 0, feePct: 0 }, t)).toEqual(["New total: 50 zł"]);
    expect(changeLines({ ...base, newTotalCents: null, feeCents: 0, feePct: 0 }, t)).toEqual([]);
  });
});

import { equipmentLines, type EquipmentOffering } from "./pricing";
import { equipmentPicksSchema } from "./pricing-rules";

const LAMP: EquipmentOffering = { id: "11111111-1111-4111-8111-111111111111", name: "ARRI", priceCents: 5000, pricingMode: "per_unit", unitCount: 2 };
const SMOKE: EquipmentOffering = { id: "22222222-2222-4222-8222-222222222222", name: "Smoke", priceCents: 8000, pricingMode: "flat", unitCount: 1 };

describe("equipmentLines (S6)", () => {
  it("per-hour × qty × hours, rounded like the S1 base line", () => {
    expect(equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 2 }], 90)).toEqual([
      { kind: "equipment", offeringId: LAMP.id, label: "ARRI", unit: "hour", qty: 2, unitCents: 5000, cents: 15000 },
    ]);
  });
  it("flat × qty ignores the duration", () => {
    expect(equipmentLines([SMOKE], [{ offeringId: SMOKE.id, qty: 1 }], 240)).toEqual([
      { kind: "equipment", offeringId: SMOKE.id, label: "Smoke", unit: "flat", qty: 1, unitCents: 8000, cents: 8000 },
    ]);
  });
  it("keeps pick order and returns [] for no picks", () => {
    const lines = equipmentLines([LAMP, SMOKE], [{ offeringId: SMOKE.id, qty: 1 }, { offeringId: LAMP.id, qty: 1 }], 60);
    expect(lines.map((l) => l.kind === "equipment" && l.offeringId)).toEqual([SMOKE.id, LAMP.id]);
    expect(equipmentLines([LAMP], [], 60)).toEqual([]);
  });
  it("refuses unknown, unpriced, duplicate and oversize picks with the sentinel", () => {
    expect(() => equipmentLines([LAMP], [{ offeringId: SMOKE.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([{ ...LAMP, priceCents: null }], [{ offeringId: LAMP.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 1 }, { offeringId: LAMP.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 3 }], 60)).toThrow("quote_equipment");
  });
});

describe("equipmentPicksSchema", () => {
  it("accepts distinct uuid picks with qty 1–99, refuses repeats", () => {
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 1 }]).success).toBe(true);
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 0 }]).success).toBe(false);
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 1 }, { offeringId: LAMP.id, qty: 2 }]).success).toBe(false);
    expect(equipmentPicksSchema.safeParse([{ offeringId: "nope", qty: 1 }]).success).toBe(false);
  });
});
