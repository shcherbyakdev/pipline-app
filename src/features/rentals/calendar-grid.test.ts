import { describe, it, expect } from "vitest";
import { monthOf, addMonths, firstOfMonth, monthGrid } from "./calendar-grid";

describe("monthOf", () => {
  it("drops the day", () => {
    expect(monthOf("2027-05-14")).toBe("2027-05");
    expect(monthOf("2028-01-01")).toBe("2028-01");
  });
});

describe("firstOfMonth", () => {
  it("appends day 01", () => {
    expect(firstOfMonth("2027-05")).toBe("2027-05-01");
    expect(firstOfMonth("2027-12")).toBe("2027-12-01");
  });
});

describe("addMonths", () => {
  it("moves forward across a year boundary", () => {
    expect(addMonths("2027-12", 1)).toBe("2028-01");
    expect(addMonths("2027-05", 1)).toBe("2027-06");
    expect(addMonths("2027-05", 7)).toBe("2027-12");
    expect(addMonths("2027-05", 8)).toBe("2028-01");
  });

  it("moves backward across a year boundary", () => {
    expect(addMonths("2028-01", -1)).toBe("2027-12");
    expect(addMonths("2027-05", -5)).toBe("2026-12");
    expect(addMonths("2027-05", 0)).toBe("2027-05");
  });
});

describe("monthGrid", () => {
  it("pads the first week with nulls up to the Monday-first weekday", () => {
    // 2027-05-01 is a Saturday → five leading nulls (Mo..Fr).
    const grid = monthGrid("2027-05");
    expect(grid[0]).toEqual([null, null, null, null, null, "2027-05-01", "2027-05-02"]);
  });

  it("pads the last week with trailing nulls", () => {
    // 2027-05-31 is a Monday → it sits alone in the final row.
    const grid = monthGrid("2027-05");
    expect(grid[grid.length - 1]).toEqual(["2027-05-31", null, null, null, null, null, null]);
  });

  it("emits every day of the month exactly once, in order, in 7-day rows", () => {
    const grid = monthGrid("2027-05");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    const days = grid.flat().filter((d): d is string => d !== null);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2027-05-01");
    expect(days[30]).toBe("2027-05-31");
    expect([...days].sort()).toEqual(days);
  });

  it("handles a month starting on Monday and a leap February", () => {
    // 2027-02-01 is a Monday → no leading nulls; 28 days.
    const feb = monthGrid("2027-02");
    expect(feb[0][0]).toBe("2027-02-01");
    expect(feb.flat().filter(Boolean)).toHaveLength(28);
    // 2028 is a leap year.
    expect(monthGrid("2028-02").flat().filter(Boolean)).toHaveLength(29);
  });
});
