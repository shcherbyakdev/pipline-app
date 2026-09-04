import { describe, it, expect } from "vitest";
import { addMonths, byDate, datesCovered, daysApart, monthEnd, monthGrid, monthStart } from "./month-grid";

describe("month bounds", () => {
  it("finds the last day of a month, leap year included", () => {
    expect(monthEnd("2026-09-14")).toBe("2026-09-30");
    expect(monthEnd("2027-02-01")).toBe("2027-02-28");
    expect(monthEnd("2028-02-09")).toBe("2028-02-29");
  });
  it("steps whole months, landing on the first", () => {
    expect(addMonths("2026-09-01", 1)).toBe("2026-10-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(monthStart("2026-09-14")).toBe("2026-09-01");
  });
  it("counts days across a DST boundary", () => {
    // Europe's clocks go back on 2026-10-25; noon-anchored, the count is exact.
    expect(daysApart("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("monthGrid", () => {
  it("starts on the Monday on or before the 1st and runs whole weeks", () => {
    const g = monthGrid("2026-09-01"); // 1 Sept 2026 is a Tuesday
    expect(g[0]).toBe("2026-08-31");
    expect(g.length % 7).toBe(0);
    expect(g.at(-1)!).toBe("2026-10-04");
  });
  it("needs six rows when a 31-day month starts on a Sunday", () => {
    expect(monthGrid("2026-11-01").length).toBe(42); // 1 Nov 2026 is a Sunday
  });
  it("needs four when February starts on a Monday and is not leap", () => {
    expect(monthGrid("2027-02-01").length).toBe(28);
  });
});

describe("datesCovered", () => {
  const appt = { startsAt: "2026-09-04T08:00:00Z", endsAt: "2026-09-04T09:00:00Z", rentalUnitId: null, rangeMode: null };
  it("puts an appointment on its start day only", () => {
    expect(datesCovered(appt, "Europe/Berlin")).toEqual(["2026-09-04"]);
  });
  it("reads the day in the org's zone, not UTC", () => {
    // 23:30 UTC is already the 5th in Warsaw.
    expect(
      datesCovered({ ...appt, startsAt: "2026-09-04T23:30:00Z", endsAt: "2026-09-05T00:30:00Z" }, "Europe/Warsaw"),
    ).toEqual(["2026-09-05"]);
  });
  it("spreads a nightly stay over the nights slept, not the checkout day", () => {
    expect(
      datesCovered(
        { startsAt: "2026-09-04T12:00:00Z", endsAt: "2026-09-07T09:00:00Z", rentalUnitId: "u", rangeMode: "nights" },
        "UTC",
      ),
    ).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
  });
  it("includes the return day for a daily stay, and treats an hourly one as timed", () => {
    const range = { startsAt: "2026-09-04T12:00:00Z", endsAt: "2026-09-05T09:00:00Z", rentalUnitId: "u" };
    expect(datesCovered({ ...range, rangeMode: "days" }, "UTC")).toEqual(["2026-09-04", "2026-09-05"]);
    expect(datesCovered({ ...range, rangeMode: "hours" }, "UTC")).toEqual(["2026-09-04"]);
  });
});

describe("byDate", () => {
  it("groups by cell, earliest start first", () => {
    const late = { startsAt: "2026-09-04T14:00:00Z", endsAt: "2026-09-04T15:00:00Z", rentalUnitId: null, rangeMode: null };
    const early = { startsAt: "2026-09-04T08:00:00Z", endsAt: "2026-09-04T09:00:00Z", rentalUnitId: null, rangeMode: null };
    const stay = { startsAt: "2026-09-03T12:00:00Z", endsAt: "2026-09-05T09:00:00Z", rentalUnitId: "u", rangeMode: "nights" as const };
    const map = byDate([late, early, stay], "UTC");
    expect(map.get("2026-09-04")).toEqual([stay, early, late]);
    expect(map.get("2026-09-03")).toEqual([stay]);
    expect(map.has("2026-09-05")).toBe(false);
  });
});
