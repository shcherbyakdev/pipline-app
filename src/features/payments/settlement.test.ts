import { describe, expect, it } from "vitest";
import { balanceCents, chargeInput, hourlyRateCents, overtimeCharge } from "./settlement";

describe("balanceCents", () => {
  const base = { priceCents: 30000, feeCents: 0, chargesCents: 0, writtenOffCents: 0, paidCents: 0, refundedCents: 0 };
  it("total minus held, with fee, charges and write-off", () => {
    expect(balanceCents(base)).toBe(30000);
    expect(balanceCents({ ...base, paidCents: 9000 })).toBe(21000);
    expect(balanceCents({ ...base, feeCents: 5000, chargesCents: 10000, paidCents: 9000 })).toBe(36000);
    expect(balanceCents({ ...base, chargesCents: 10000, writtenOffCents: 40000 })).toBe(0);
    expect(balanceCents({ ...base, paidCents: 30000, refundedCents: 10000 })).toBe(10000);
  });
  it("negative means overpaid; unpriced counts as 0", () => {
    expect(balanceCents({ ...base, paidCents: 35000 })).toBe(-5000);
    expect(balanceCents({ ...base, priceCents: null, chargesCents: 2000 })).toBe(2000);
  });
});

describe("hourlyRateCents", () => {
  const h = (n: number) => new Date(Date.UTC(2027, 2, 10, 10 + n));
  it("rules-priced: the base line's unit", () => {
    expect(hourlyRateCents({ lines: [{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }], priceCents: 24000, startsAt: h(0), endsAt: h(2) })).toBe(12000);
  });
  it("flat per-unit: price / hours; null when unpriced or a null base unit", () => {
    expect(hourlyRateCents({ lines: null, priceCents: 30000, startsAt: h(0), endsAt: h(3) })).toBe(10000);
    expect(hourlyRateCents({ lines: null, priceCents: null, startsAt: h(0), endsAt: h(3) })).toBeNull();
    expect(hourlyRateCents({ lines: [{ kind: "base", qty: 2, unitCents: null, cents: 24000 }], priceCents: 24000, startsAt: h(0), endsAt: h(2) })).toBe(12000);
  });
});

describe("overtimeCharge", () => {
  it("rounds up to 30-minute blocks at half the hourly rate", () => {
    expect(overtimeCharge(0, 10000)).toEqual({ qty: 0, unitCents: 5000, cents: 0 });
    expect(overtimeCharge(10, 10000)).toEqual({ qty: 1, unitCents: 5000, cents: 5000 });
    expect(overtimeCharge(30, 10000)).toEqual({ qty: 1, unitCents: 5000, cents: 5000 });
    expect(overtimeCharge(31, 10000)).toEqual({ qty: 2, unitCents: 5000, cents: 10000 });
    expect(overtimeCharge(90, 10000)).toEqual({ qty: 3, unitCents: 5000, cents: 15000 });
    expect(overtimeCharge(30, 12345)).toEqual({ qty: 1, unitCents: 6173, cents: 6173 }); // half-up
  });
});

describe("chargeInput", () => {
  it("accepts a preset with a label, trims, computes nothing", () => {
    expect(chargeInput.parse({ bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "cleaning", label: " Cleaning ", qty: 1, unitCents: 15000 })).toEqual({
      bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "cleaning", label: "Cleaning", qty: 1, unitCents: 15000,
    });
  });
  it("rejects an unknown kind, an empty label, qty 0, negative or huge amounts", () => {
    const ok = { bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "other", label: "x", qty: 1, unitCents: 100 };
    expect(chargeInput.safeParse({ ...ok, kind: "tips" }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, label: "  " }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, qty: 0 }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, unitCents: -1 }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, unitCents: 10_000_001 }).success).toBe(false);
  });
});
