import { describe, it, expect } from "vitest";
import { effectiveWindows, subtractRange } from "./day-windows";

const RULES = [
  { weekday: 2, startTime: "09:00", endTime: "12:00" },
  { weekday: 2, startTime: "13:00", endTime: "17:00" },
];
// 2027-05-04 is a Tuesday (weekday 2)
const D = "2027-05-04";

describe("effectiveWindows", () => {
  it("uses weekday rules when no exceptions, sorted", () => {
    expect(effectiveWindows(D, RULES, [])).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "13:00", endTime: "17:00" },
    ]);
  });
  it("closed exception empties the day", () => {
    expect(effectiveWindows(D, RULES, [{ date: D, closed: true, startTime: null, endTime: null }])).toEqual([]);
  });
  it("open exceptions replace the rules", () => {
    expect(
      effectiveWindows(D, RULES, [{ date: D, closed: false, startTime: "10:00", endTime: "14:00" }]),
    ).toEqual([{ startTime: "10:00", endTime: "14:00" }]);
  });
  it("ignores exceptions for other dates", () => {
    expect(effectiveWindows(D, RULES, [{ date: "2027-05-05", closed: true, startTime: null, endTime: null }]))
      .toHaveLength(2);
  });
});

describe("subtractRange", () => {
  const W = [{ startTime: "09:00", endTime: "17:00" }];
  it("splits a window on an interior range", () => {
    expect(subtractRange(W, "12:00", "13:00")).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "13:00", endTime: "17:00" },
    ]);
  });
  it("trims edge overlaps", () => {
    expect(subtractRange(W, "08:00", "10:00")).toEqual([{ startTime: "10:00", endTime: "17:00" }]);
    expect(subtractRange(W, "16:00", "18:00")).toEqual([{ startTime: "09:00", endTime: "16:00" }]);
  });
  it("drops a fully covered window", () => {
    expect(subtractRange(W, "08:00", "18:00")).toEqual([]);
  });
  it("keeps disjoint windows untouched", () => {
    expect(subtractRange(W, "18:00", "19:00")).toEqual(W);
  });
  it("drops fragments shorter than 5 minutes", () => {
    expect(subtractRange(W, "09:03", "16:57")).toEqual([]);
  });
  it("handles multiple windows", () => {
    expect(
      subtractRange(
        [{ startTime: "09:00", endTime: "12:00" }, { startTime: "13:00", endTime: "17:00" }],
        "11:00", "14:00",
      ),
    ).toEqual([{ startTime: "09:00", endTime: "11:00" }, { startTime: "14:00", endTime: "17:00" }]);
  });
});
