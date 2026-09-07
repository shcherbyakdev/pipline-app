import { describe, it, expect } from "vitest";
import { pricingRulesFor, pricingRulesSchema, slugify, extraPicksSchema } from "./pricing-rules";

const ok = {
  bands: [{ fromMin: 60, perHourCents: 14000 }, { fromMin: 120, perHourCents: 12000 }],
  surcharges: [{ label: "Noc", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" }],
  people: { included: 5, extraCents: 1000, max: 10 },
  extras: [{ id: "arri-2-kw", label: "ARRI 2 kW", unit: "hour", priceCents: 5000, maxQty: 2 }],
};

describe("pricingRulesSchema", () => {
  it("accepts the reference rules", () => {
    expect(pricingRulesSchema.safeParse(ok).success).toBe(true);
  });
  it("accepts an empty ruleset apart from one band", () => {
    expect(pricingRulesSchema.safeParse({ bands: [{ fromMin: 30, totalCents: 5000 }], surcharges: [], extras: [] }).success).toBe(true);
  });
  const bad = (patch: Record<string, unknown>, path: string) => {
    const r = pricingRulesSchema.safeParse({ ...ok, ...patch });
    expect(r.success, path).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join(".")).some((p) => p.startsWith(path)), path).toBe(true);
  };
  it("needs at least one band and at most eight", () => {
    bad({ bands: [] }, "bands");
    bad({ bands: Array.from({ length: 9 }, (_, i) => ({ fromMin: 60 + i * 30, perHourCents: 100 })) }, "bands");
  });
  it("bands ascend by fromMin without repeats", () => {
    bad({ bands: [{ fromMin: 120, perHourCents: 1 }, { fromMin: 60, perHourCents: 1 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 1 }, { fromMin: 60, totalCents: 1 }] }, "bands");
  });
  it("a band carries exactly one of perHourCents / totalCents", () => {
    bad({ bands: [{ fromMin: 60 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 1, totalCents: 1 }] }, "bands");
  });
  it("surcharge pct 1–200, days a non-empty subset of 0–6, from ≠ to", () => {
    bad({ surcharges: [{ ...ok.surcharges[0], pct: 0 }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], pct: 201 }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], days: [] }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], days: [7] }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], from: "22:00", to: "22:00" }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], from: "22" }] }, "surcharges");
  });
  it("people: max ≥ included, max ≤ 500", () => {
    bad({ people: { included: 6, extraCents: 100, max: 5 } }, "people");
    bad({ people: { included: 0, extraCents: 100, max: 501 } }, "people");
  });
  it("extras: unique slug ids, unit hour|piece, maxQty 1–99, label ≤ 60", () => {
    bad({ extras: [ok.extras[0], { ...ok.extras[0] }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], id: "ARRI" }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], unit: "day" }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], maxQty: 0 }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], label: "x".repeat(61) }] }, "extras");
  });
  it("pricingRulesFor(min) refuses a first band above the minimum duration", () => {
    expect(pricingRulesFor(60).safeParse(ok).success).toBe(true);
    expect(pricingRulesFor(30).safeParse(ok).success).toBe(false);
  });
  it("cents are integers within 0–100 000 000", () => {
    bad({ bands: [{ fromMin: 60, perHourCents: 1.5 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 100_000_001 }] }, "bands");
  });
});

describe("slugify", () => {
  it("lowercases, strips diacritics and punctuation, joins with dashes, caps at 32", () => {
    expect(slugify("ARRI 2 kW")).toBe("arri-2-kw");
    expect(slugify("Tło kartonowe (biały)")).toBe("tlo-kartonowe-bialy");
    expect(slugify("x".repeat(40))).toHaveLength(32);
    expect(slugify("   ")).toBe("");
  });
});

describe("extraPicksSchema", () => {
  it("accepts picks and refuses duplicates, zero qty, bad ids", () => {
    expect(extraPicksSchema.safeParse([{ id: "arri-2-kw", qty: 1 }]).success).toBe(true);
    expect(extraPicksSchema.safeParse([{ id: "a", qty: 1 }, { id: "a", qty: 1 }]).success).toBe(false);
    expect(extraPicksSchema.safeParse([{ id: "a", qty: 0 }]).success).toBe(false);
    expect(extraPicksSchema.safeParse([{ id: "A!", qty: 1 }]).success).toBe(false);
  });
});
