import { describe, it, expect } from "vitest";
import {
  daysBetween, stayLength, occupiedDates, computeRangeAvailability, validateStay,
  type RangeInput,
} from "./range";

const TZ = "Europe/Berlin";
const NOW = new Date("2027-05-01T08:00:00Z"); // 10:00 Berlin, a Saturday

function input(over: Partial<RangeInput> = {}): RangeInput {
  return {
    offering: { rangeMode: "nights", minStay: 1, maxStay: null, turnoverDays: 0, minNoticeDays: 0, bookingWindowDays: 365 },
    units: [{ id: "u1", sortOrder: 0 }, { id: "u2", sortOrder: 1 }],
    blackouts: [],
    bookings: [],
    timeZone: TZ,
    now: NOW,
    fromDate: "2027-05-01",
    days: 31,
    ...over,
  };
}
// 15:00 Berlin check-in on 2027-05-10 (CEST) = 13:00Z; 11:00 check-out 05-13 = 09:00Z
const stay = (unitId: string, s: string, e: string) => ({ unitId, startsAt: new Date(s), endsAt: new Date(e) });

describe("helpers", () => {
  it("daysBetween / stayLength / occupiedDates", () => {
    expect(daysBetween("2027-05-01", "2027-05-04")).toBe(3);
    expect(stayLength("nights", "2027-05-01", "2027-05-04")).toBe(3);
    expect(stayLength("days", "2027-05-01", "2027-05-04")).toBe(4);
    expect(occupiedDates("nights", "2027-05-01", "2027-05-04")).toEqual({ start: "2027-05-01", end: "2027-05-03" });
    expect(occupiedDates("days", "2027-05-01", "2027-05-04")).toEqual({ start: "2027-05-01", end: "2027-05-04" });
  });
});

describe("computeRangeAvailability", () => {
  it("all units free on an empty calendar; dates before notice / after window unavailable", () => {
    const a = computeRangeAvailability(input({ offering: { ...input().offering, minNoticeDays: 2, bookingWindowDays: 10 } }));
    expect(a.notBefore).toBe("2027-05-03");
    expect(a.notAfter).toBe("2027-05-11");
    expect(a.dates["2027-05-02"]).toEqual({ free: 0, unitIds: [] });
    expect(a.dates["2027-05-03"]).toEqual({ free: 2, unitIds: ["u1", "u2"] });
    expect(a.dates["2027-05-11"].free).toBe(2);
    expect(a.dates["2027-05-12"].free).toBe(0);
    expect(Object.keys(a.dates)).toHaveLength(31);
  });

  it("nights: a stay occupies check-in..night-before-checkout; checkout day is free again", () => {
    const a = computeRangeAvailability(input({ bookings: [stay("u1", "2027-05-10T13:00:00Z", "2027-05-13T09:00:00Z")] }));
    expect(a.dates["2027-05-09"].unitIds).toEqual(["u1", "u2"]);
    expect(a.dates["2027-05-10"].unitIds).toEqual(["u2"]);
    expect(a.dates["2027-05-12"].unitIds).toEqual(["u2"]);
    expect(a.dates["2027-05-13"].unitIds).toEqual(["u1", "u2"]);
  });

  it("days: the return day is occupied", () => {
    const a = computeRangeAvailability(input({
      offering: { ...input().offering, rangeMode: "days" },
      // pickup 09:00 05-10 → return 18:00 05-12 (CEST: 07:00Z / 16:00Z)
      bookings: [stay("u1", "2027-05-10T07:00:00Z", "2027-05-12T16:00:00Z")],
    }));
    expect(a.dates["2027-05-12"].unitIds).toEqual(["u2"]);
    expect(a.dates["2027-05-13"].unitIds).toEqual(["u1", "u2"]);
  });

  it("turnover blocks days after a stay; blackouts block their inclusive range", () => {
    const a = computeRangeAvailability(input({
      offering: { ...input().offering, turnoverDays: 1 },
      bookings: [stay("u1", "2027-05-10T13:00:00Z", "2027-05-13T09:00:00Z")],
      blackouts: [{ unitId: "u2", startDate: "2027-05-20", endDate: "2027-05-21" }],
    }));
    expect(a.dates["2027-05-13"].unitIds).toEqual(["u2"]); // turnover day
    expect(a.dates["2027-05-14"].unitIds).toEqual(["u1", "u2"]);
    expect(a.dates["2027-05-19"].unitIds).toEqual(["u1", "u2"]);
    expect(a.dates["2027-05-20"].unitIds).toEqual(["u1"]);
    expect(a.dates["2027-05-21"].unitIds).toEqual(["u1"]);
    expect(a.dates["2027-05-22"].unitIds).toEqual(["u1", "u2"]);
  });

  it("clamps a marked range to the requested window (an open-ended blackout terminates fast)", () => {
    // Without the clamp this expands ~2.9M dates day by day.
    const started = Date.now();
    const open = computeRangeAvailability(input({
      blackouts: [{ unitId: "u1", startDate: "2027-01-01", endDate: "9999-12-31" }],
    }));
    const elapsed = Date.now() - started;
    const equivalent = computeRangeAvailability(input({
      blackouts: [{ unitId: "u1", startDate: "2027-05-01", endDate: "2027-05-31" }],
    }));
    expect(open.dates).toEqual(equivalent.dates);
    expect(open.dates["2027-05-15"]).toEqual({ free: 1, unitIds: ["u2"] });
    expect(elapsed).toBeLessThan(200);
  });

  it("derives dates in the org zone across DST (a stay ending 02:00Z after fall-back is still that local date)", () => {
    // 2027-10-31 is EU fall-back. Check-out 11:00 local on 11-01 = 10:00Z (CET).
    const a = computeRangeAvailability(input({
      now: new Date("2027-10-20T08:00:00Z"), fromDate: "2027-10-28", days: 10,
      bookings: [stay("u1", "2027-10-30T13:00:00Z", "2027-11-01T10:00:00Z")],
    }));
    expect(a.dates["2027-10-31"].unitIds).toEqual(["u2"]);
    expect(a.dates["2027-11-01"].unitIds).toEqual(["u1", "u2"]);
  });
});

describe("validateStay", () => {
  const off = input().offering;

  it("rejects wrong order per mode", () => {
    const a = computeRangeAvailability(input());
    expect(validateStay(off, a, "2027-05-05", "2027-05-05")).toEqual({ ok: false, reason: "order" });
    expect(validateStay({ ...off, rangeMode: "days" }, a, "2027-05-05", "2027-05-05").ok).toBe(true);
    expect(validateStay({ ...off, rangeMode: "days" }, a, "2027-05-06", "2027-05-05")).toEqual({ ok: false, reason: "order" });
  });

  it("enforces min/max stay and the window", () => {
    const a = computeRangeAvailability(input({ offering: { ...off, minStay: 2, maxStay: 4, bookingWindowDays: 20 } }));
    const o = { ...off, minStay: 2, maxStay: 4, bookingWindowDays: 20 };
    expect(validateStay(o, a, "2027-05-05", "2027-05-06")).toEqual({ ok: false, reason: "min_stay" });
    expect(validateStay(o, a, "2027-05-05", "2027-05-10")).toEqual({ ok: false, reason: "max_stay" });
    expect(validateStay(o, a, "2027-05-19", "2027-05-22")).toEqual({ ok: false, reason: "window" }); // end > notAfter (05-21)
    expect(validateStay(o, a, "2027-05-05", "2027-05-08")).toEqual({ ok: true, unitIds: ["u1", "u2"] });
  });

  it("requires the same unit to be free for every occupied night (+turnover)", () => {
    // u1 busy 05-10..05-12 (nights), u2 busy 05-14..05-15 → no single unit spans 05-11..05-16
    const a = computeRangeAvailability(input({
      bookings: [stay("u1", "2027-05-10T13:00:00Z", "2027-05-13T09:00:00Z"), stay("u2", "2027-05-14T13:00:00Z", "2027-05-16T09:00:00Z")],
    }));
    expect(validateStay(off, a, "2027-05-11", "2027-05-16")).toEqual({ ok: false, reason: "unavailable" });
    expect(validateStay(off, a, "2027-05-13", "2027-05-14")).toEqual({ ok: true, unitIds: ["u1", "u2"] });
    expect(validateStay(off, a, "2027-05-13", "2027-05-15")).toEqual({ ok: true, unitIds: ["u1"] });
    // turnover: a stay ending right before u2's booking needs its cleaning day free
    const t = computeRangeAvailability(input({ offering: { ...off, turnoverDays: 1 }, bookings: [stay("u2", "2027-05-14T13:00:00Z", "2027-05-16T09:00:00Z")] }));
    expect(validateStay({ ...off, turnoverDays: 1 }, t, "2027-05-12", "2027-05-14")).toEqual({ ok: true, unitIds: ["u1"] }); // u2's turnover after 05-13 night lands on 05-14, u2 booked
    // a date missing from the map counts as unavailable
    expect(validateStay(off, a, "2027-05-30", "2027-06-02")).toEqual({ ok: false, reason: "unavailable" });
  });
});
