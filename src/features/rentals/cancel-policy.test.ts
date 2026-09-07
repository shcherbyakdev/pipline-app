import { describe, expect, it } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import {
  adminCancelMoney,
  cancelFeeCents,
  cancelFeePct,
  cancelPolicySchema,
  formatCancelPolicy,
  type CancelPolicy,
} from "./cancel-policy";

const t = enTranslator("public.units");
const H = 60;
const D = 1440;
const start = new Date("2027-03-10T10:00:00Z");
const before = (min: number) => new Date(start.getTime() - min * 60_000);
const TWO: CancelPolicy = [
  { beforeMin: 72 * H, feePct: 0 },
  { beforeMin: 48 * H, feePct: 50 },
];

describe("cancelPolicySchema", () => {
  it("sorts descending and keeps unique leads", () => {
    expect(cancelPolicySchema.parse([{ beforeMin: 48 * H, feePct: 50 }, { beforeMin: 72 * H, feePct: 0 }])).toEqual(TWO);
  });
  it("rejects duplicate leads, more than five tiers, and out-of-range values", () => {
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60, feePct: 0 }, { beforeMin: 60, feePct: 50 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse(Array.from({ length: 6 }, (_, i) => ({ beforeMin: i * 60, feePct: 0 }))).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: -1, feePct: 0 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60, feePct: 101 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60.5, feePct: 0 }]).success).toBe(false);
  });
  it("accepts an empty policy and a beforeMin of 0", () => {
    expect(cancelPolicySchema.parse([])).toEqual([]);
    expect(cancelPolicySchema.parse([{ beforeMin: 0, feePct: 80 }])).toEqual([{ beforeMin: 0, feePct: 80 }]);
  });
});

describe("cancelFeePct", () => {
  it("empty or null policy → 0", () => {
    expect(cancelFeePct([], start, before(10))).toBe(0);
    expect(cancelFeePct(null, start, before(10))).toBe(0);
  });
  it("picks the largest lead still met; the boundary itself is met", () => {
    expect(cancelFeePct(TWO, start, before(80 * H))).toBe(0);
    expect(cancelFeePct(TWO, start, before(72 * H))).toBe(0);
    expect(cancelFeePct(TWO, start, before(72 * H - 1))).toBe(50);
    expect(cancelFeePct(TWO, start, before(48 * H))).toBe(50);
  });
  it("no tier met → 100", () => {
    expect(cancelFeePct(TWO, start, before(48 * H - 1))).toBe(100);
    expect(cancelFeePct(TWO, start, before(0))).toBe(100);
    expect(cancelFeePct([{ beforeMin: 24 * H, feePct: 0 }], start, before(1))).toBe(100);
  });
  it("a beforeMin of 0 tier covers everything up to the start", () => {
    const p: CancelPolicy = [{ beforeMin: 24 * H, feePct: 0 }, { beforeMin: 0, feePct: 80 }];
    expect(cancelFeePct(p, start, before(1))).toBe(80);
    expect(cancelFeePct(p, start, before(0))).toBe(80);
  });
  it("ignores the input order (SQL is order-independent too)", () => {
    expect(cancelFeePct([...TWO].reverse(), start, before(80 * H))).toBe(0);
  });
});

describe("cancelFeeCents", () => {
  it("rounds half up on the total and is 0 for an unpriced booking", () => {
    expect(cancelFeeCents(TWO, 30000, start, before(60 * H))).toBe(15000);
    expect(cancelFeeCents([{ beforeMin: 0, feePct: 33 }], 101, start, before(1))).toBe(33); // 33.33 → 33
    expect(cancelFeeCents([{ beforeMin: 0, feePct: 50 }], 101, start, before(1))).toBe(51); // 50.5 → 51
    expect(cancelFeeCents(TWO, null, start, before(1))).toBe(0);
  });
});

describe("formatCancelPolicy", () => {
  it("null for an empty policy", () => {
    expect(formatCancelPolicy([], t)).toBeNull();
    expect(formatCancelPolicy(null, t)).toBeNull();
  });
  it("one free tier reads as free-until, then 100%", () => {
    expect(formatCancelPolicy([{ beforeMin: 3 * D, feePct: 0 }], t)).toBe(
      "Free cancellation until 3 days before start · 100% after that",
    );
  });
  it("two tiers join with · and end in the trailing pct", () => {
    // 72 h and 48 h are exact day multiples — formatCancelWindow (unchanged
    // from pricing.ts, see its own "whole days say days" test) renders those
    // in days, not hours.
    expect(formatCancelPolicy(TWO, t)).toBe(
      "Free cancellation until 3 days before start · 50% fee until 2 days before · 100% after that",
    );
  });
  it("a beforeMin of 0 tier replaces the trailing 100%", () => {
    expect(formatCancelPolicy([{ beforeMin: 24 * H, feePct: 0 }, { beforeMin: 0, feePct: 80 }], t)).toBe(
      "Free cancellation until 1 day before start · 80% after that",
    );
  });
});

describe("adminCancelMoney", () => {
  const b = { cancelPolicy: TWO, priceCents: 30000, startsAt: start, paidCents: 9000, refundedCents: 0 };
  it("policy: fee from the tier, refund what is left", () => {
    expect(adminCancelMoney("policy", b, before(60 * H))).toEqual({ feeCents: 15000, refundCents: 0 });
    expect(adminCancelMoney("policy", b, before(80 * H))).toEqual({ feeCents: 0, refundCents: 9000 });
    expect(adminCancelMoney("policy", { ...b, priceCents: 10000 }, before(60 * H))).toEqual({ feeCents: 5000, refundCents: 4000 });
  });
  it("all: no fee, everything back; none: keep what was paid", () => {
    expect(adminCancelMoney("all", b, before(1))).toEqual({ feeCents: 0, refundCents: 9000 });
    expect(adminCancelMoney("none", b, before(1))).toEqual({ feeCents: 9000, refundCents: 0 });
  });
  it("already-refunded money is never counted twice", () => {
    expect(adminCancelMoney("all", { ...b, refundedCents: 4000 }, before(1))).toEqual({ feeCents: 0, refundCents: 5000 });
    expect(adminCancelMoney("none", { ...b, refundedCents: 4000 }, before(1))).toEqual({ feeCents: 5000, refundCents: 0 });
  });
});
