import { describe, it, expect } from "vitest";
import { effectiveWindows, subtractRange, addRange, mergeWindows, unionWindows } from "./day-windows";

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

describe("addRange", () => {
  it("opens a range on an empty day", () => {
    expect(addRange([], "10:00", "12:00")).toEqual([{ startTime: "10:00", endTime: "12:00" }]);
  });
  it("bridges adjacent windows back together (restore a blocked slot)", () => {
    expect(
      addRange(
        [{ startTime: "09:00", endTime: "14:00" }, { startTime: "15:00", endTime: "17:00" }],
        "14:00", "15:00",
      ),
    ).toEqual([{ startTime: "09:00", endTime: "17:00" }]);
  });
  it("keeps disjoint windows separate", () => {
    expect(addRange([{ startTime: "09:00", endTime: "12:00" }], "14:00", "15:00")).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "14:00", endTime: "15:00" },
    ]);
  });
  it("is a no-op inside an already open window", () => {
    expect(addRange([{ startTime: "09:00", endTime: "17:00" }], "10:00", "11:00")).toEqual([
      { startTime: "09:00", endTime: "17:00" },
    ]);
  });
  it("extends a window on partial overlap", () => {
    expect(addRange([{ startTime: "09:00", endTime: "12:00" }], "11:00", "14:00")).toEqual([
      { startTime: "09:00", endTime: "14:00" },
    ]);
  });
});

describe("mergeWindows", () => {
  it("sorts and coalesces overlapping and touching windows", () => {
    expect(
      mergeWindows([
        { startTime: "13:00", endTime: "17:00" },
        { startTime: "09:00", endTime: "11:00" },
        { startTime: "10:30", endTime: "13:00" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "17:00" }]);
    expect(mergeWindows([])).toEqual([]);
  });
});

describe("unionWindows (multi-staff week)", () => {
  const ANNA = { rules: RULES, exceptions: [] };
  const BEN = { rules: [{ weekday: 2, startTime: "11:00", endTime: "15:00" }], exceptions: [] };

  it("is the union of each person's own day", () => {
    expect(unionWindows(D, [ANNA, BEN])).toEqual([{ startTime: "09:00", endTime: "17:00" }]);
  });
  it("one person's closed override does not empty the day for the others", () => {
    const annaOff = { ...ANNA, exceptions: [{ date: D, closed: true, startTime: null, endTime: null }] };
    expect(unionWindows(D, [annaOff, BEN])).toEqual([{ startTime: "11:00", endTime: "15:00" }]);
    // Pooling the rows (the old behaviour) would have returned [].
    expect(effectiveWindows(D, [...ANNA.rules, ...BEN.rules], annaOff.exceptions)).toEqual([]);
  });
  it("one person's open override replaces only their own rules", () => {
    const benLate = { ...BEN, exceptions: [{ date: D, closed: false, startTime: "18:00", endTime: "20:00" }] };
    expect(unionWindows(D, [ANNA, benLate])).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "13:00", endTime: "17:00" },
      { startTime: "18:00", endTime: "20:00" },
    ]);
    // Pooled, Ben's override would have replaced Anna's hours too.
    expect(effectiveWindows(D, [...ANNA.rules, ...BEN.rules], benLate.exceptions)).toEqual([
      { startTime: "18:00", endTime: "20:00" },
    ]);
  });
  it("one person collapses to effectiveWindows", () => {
    expect(unionWindows(D, [ANNA])).toEqual(effectiveWindows(D, RULES, []));
    expect(unionWindows(D, [])).toEqual([]);
  });
});
