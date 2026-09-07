// The one fixture the TS quote (pricing.test.ts) and the SQL quote
// (pricing-quote.integration.test.ts) both run — the lockstep contract.
import type { ExtraPick, Line, PricingRules } from "./pricing-rules";

export const FIXTURE_TZ = "Europe/Warsaw";
export const MON = "2027-03-01";
export const SAT = "2027-03-06";
export const SUN = "2027-03-07";

export const FIXTURE_RULES: PricingRules = {
  bands: [
    { fromMin: 60, perHourCents: 14000 },
    { fromMin: 90, totalCents: 19500 },
    { fromMin: 120, perHourCents: 12000 },
  ],
  surcharges: [
    { label: "Noc", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" },
    { label: "Niedziela", pct: 10, days: [0], from: "08:00", to: "22:00" },
  ],
  people: { included: 5, extraCents: 1000, max: 10 },
  extras: [
    { id: "arri", label: "ARRI 2 kW", unit: "hour", priceCents: 5000, maxQty: 2 },
    { id: "tlo", label: "Tło kartonowe", unit: "piece", priceCents: 1500, maxQty: 10 },
  ],
};

const base = (qty: number, unitCents: number | null, cents: number): Line => ({ kind: "base", qty, unitCents, cents });

export const FIXTURE_CASES: {
  name: string; startsLocal: string; durationMin: number; people: number | null; extras: ExtraPick[];
  expect: Line[] | "quote_band" | "quote_people" | "quote_extra";
}[] = [
  { name: "60 min Monday noon: first band", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [],
    expect: [base(1, 14000, 14000)] },
  { name: "90 min: fixed-total band", startsLocal: `${MON}T12:00`, durationMin: 90, people: null, extras: [],
    expect: [base(1.5, null, 19500)] },
  { name: "120 min: third band applies to the whole booking", startsLocal: `${MON}T12:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000)] },
  { name: "150 min: still the third band (last with fromMin ≤ duration)", startsLocal: `${MON}T12:00`, durationMin: 150, people: null, extras: [],
    expect: [base(2.5, 12000, 30000)] },
  { name: "30 min: below the first band", startsLocal: `${MON}T12:00`, durationMin: 30, people: null, extras: [], expect: "quote_band" },
  { name: "21:00–23:00 Monday: 60 of 120 min in the night window", startsLocal: `${MON}T21:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000), { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 }] },
  { name: "23:00 Sat → 01:00 Sun: whole booking in a window that crosses midnight", startsLocal: `${SAT}T23:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000), { kind: "surcharge", qty: 120, unitCents: null, cents: 6000, label: "Noc", pct: 25 }] },
  { name: "Sunday 10:00: the Sunday-only window, not the night one", startsLocal: `${SUN}T10:00`, durationMin: 60, people: null, extras: [],
    expect: [base(1, 14000, 14000), { kind: "surcharge", qty: 60, unitCents: null, cents: 1400, label: "Niedziela", pct: 10 }] },
  { name: "Sunday 21:00–23:00: both windows overlap, two lines", startsLocal: `${SUN}T21:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000),
      { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 },
      { kind: "surcharge", qty: 60, unitCents: null, cents: 1200, label: "Niedziela", pct: 10 }] },
  { name: "people at the included count: no line", startsLocal: `${MON}T12:00`, durationMin: 60, people: 5, extras: [],
    expect: [base(1, 14000, 14000)] },
  { name: "people above included", startsLocal: `${MON}T12:00`, durationMin: 60, people: 7, extras: [],
    expect: [base(1, 14000, 14000), { kind: "people", qty: 2, unitCents: 1000, cents: 2000 }] },
  { name: "people above max", startsLocal: `${MON}T12:00`, durationMin: 60, people: 11, extras: [], expect: "quote_people" },
  { name: "extra per hour × 2 over 90 min (fixed-total band)", startsLocal: `${MON}T12:00`, durationMin: 90, people: null, extras: [{ id: "arri", qty: 2 }],
    expect: [base(1.5, null, 19500), { kind: "extra", qty: 2, unitCents: 5000, cents: 15000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" }] },
  { name: "extra per piece × 3", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "tlo", qty: 3 }],
    expect: [base(1, 14000, 14000), { kind: "extra", qty: 3, unitCents: 1500, cents: 4500, extraId: "tlo", label: "Tło kartonowe", unit: "piece" }] },
  { name: "extra over maxQty", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "arri", qty: 3 }], expect: "quote_extra" },
  { name: "unknown extra", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "fog", qty: 1 }], expect: "quote_extra" },
  { name: "everything at once, Sunday night", startsLocal: `${SUN}T21:00`, durationMin: 120, people: 8, extras: [{ id: "arri", qty: 1 }, { id: "tlo", qty: 2 }],
    expect: [base(2, 12000, 24000),
      { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 },
      { kind: "surcharge", qty: 60, unitCents: null, cents: 1200, label: "Niedziela", pct: 10 },
      { kind: "people", qty: 3, unitCents: 1000, cents: 3000 },
      { kind: "extra", qty: 1, unitCents: 5000, cents: 10000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" },
      { kind: "extra", qty: 2, unitCents: 1500, cents: 3000, extraId: "tlo", label: "Tło kartonowe", unit: "piece" }] },
];

/** NULL-pricing fallback cases: the H3 flat rate, unchanged. */
export const FALLBACK_CASES = [
  { name: "per_unit 120 zł/h × 90 min", priceCents: 12000, pricingMode: "per_unit" as const, durationMin: 90, expect: [base(1.5, 12000, 18000)] },
  { name: "flat 300 zł regardless of length", priceCents: 30000, pricingMode: "flat" as const, durationMin: 90, expect: [base(1.5, null, 30000)] },
  { name: "unpriced: no lines", priceCents: null, pricingMode: "per_unit" as const, durationMin: 90, expect: [] as Line[] },
];
