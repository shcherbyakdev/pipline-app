import { describe, it, expect } from "vitest";
import { nextFreeStays, stayLengthOptions } from "./next-free-stays";
import type { RangeAvailability } from "./range";

const days = (from: string, n: number, booked: string[] = []): RangeAvailability["dates"] => {
  const out: RangeAvailability["dates"] = {};
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 8, Number(from.slice(8)) + i)).toISOString().slice(0, 10);
    out[d] = booked.includes(d) ? { free: 0, unitIds: [] } : { free: 1, unitIds: ["u1"] };
  }
  return out;
};
const nights = { rangeMode: "nights" as const, minStay: 2, maxStay: null, turnoverDays: 0, minNoticeDays: 0, bookingWindowDays: 180, startTime: "15:00" };
const av: RangeAvailability = { dates: days("2026-09-01", 14, ["2026-09-05"]), notBefore: "2026-09-01", notAfter: "2026-09-14" };

describe("nextFreeStays — the soonest windows that fit the minimum stay", () => {
  it("lists one shortest stay per free start day, in date order, skipping starts the booked night blocks", () => {
    expect(nextFreeStays(nights, av, 4)).toEqual([
      { start: "2026-09-01", end: "2026-09-03", length: 2 },
      { start: "2026-09-02", end: "2026-09-04", length: 2 },
      { start: "2026-09-03", end: "2026-09-05", length: 2 },
      { start: "2026-09-06", end: "2026-09-08", length: 2 },
    ]);
  });
  it("days mode: a one-day minimum is pickup and return on the same day", () => {
    const daysOffering = { ...nights, rangeMode: "days" as const, minStay: 1 };
    expect(nextFreeStays(daysOffering, av, 2)).toEqual([
      { start: "2026-09-01", end: "2026-09-01", length: 1 },
      { start: "2026-09-02", end: "2026-09-02", length: 1 },
    ]);
  });
  it("respects the limit and the booking window, and returns nothing when nothing fits", () => {
    expect(nextFreeStays(nights, av, 1)).toHaveLength(1);
    const full: RangeAvailability = { ...av, dates: days("2026-09-01", 14, Object.keys(av.dates)) };
    expect(nextFreeStays(nights, full, 5)).toEqual([]);
  });
});

describe("stay length choice", () => {
  it("offers lengths from the minimum up to the maximum, at most eight", () => {
    expect(stayLengthOptions({ minStay: 2, maxStay: 3 })).toEqual([2, 3]);
    expect(stayLengthOptions({ minStay: 2, maxStay: 14 })).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stayLengthOptions({ minStay: 1, maxStay: null })).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("lists windows of the chosen length, not just the minimum", () => {
    expect(nextFreeStays(nights, av, 3, 3)).toEqual([
      { start: "2026-09-01", end: "2026-09-04", length: 3 },
      { start: "2026-09-02", end: "2026-09-05", length: 3 },
      { start: "2026-09-06", end: "2026-09-09", length: 3 },
    ]);
    expect(nextFreeStays(nights, av, 1, 1)).toEqual([]);
  });
});
