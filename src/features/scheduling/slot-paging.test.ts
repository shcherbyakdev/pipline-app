import { describe, it, expect } from "vitest";
import {
  FIRST_LOOK_DAYS, PAGE_DAYS, firstLookDays, shiftDays, mondayOf, windowAround, homeWindow, shiftWindow, windowEnd, firstDayBeyond, relativeDayLabel,
} from "./slot-paging";

const dayOf = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-09-02"; // a Wednesday

describe("shiftDays", () => {
  it("adds calendar days across month and year ends", () => {
    expect(shiftDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("mondayOf: Monday-first weeks", () => {
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
    expect(mondayOf("2026-08-31")).toBe("2026-08-31");
    expect(mondayOf("2026-09-06")).toBe("2026-08-31");
  });
});

describe("windows per layout", () => {
  it("week list: seven days from the day itself", () => {
    expect(windowAround("week-list", "2026-09-10", TODAY)).toEqual({ from: "2026-09-10", days: 7 });
    expect(homeWindow("week-list", TODAY)).toEqual({ from: TODAY, days: PAGE_DAYS });
  });
  it("week columns: the Monday-first week holding the day", () => {
    expect(windowAround("week-columns", "2026-09-10", TODAY)).toEqual({ from: "2026-09-07", days: 7 });
    expect(homeWindow("week-columns", TODAY)).toEqual({ from: "2026-08-31", days: 7 });
  });
  it("calendar: the month holding the day, never reaching into the past, never over getSlots' 31-day cap", () => {
    expect(windowAround("calendar", "2026-09-20", TODAY)).toEqual({ from: TODAY, days: 29 });
    expect(windowAround("calendar", "2026-10-05", TODAY)).toEqual({ from: "2026-10-01", days: 31 });
    expect(windowAround("calendar", "2027-02-10", TODAY)).toEqual({ from: "2027-02-01", days: 28 });
    expect(windowEnd(windowAround("calendar", "2026-10-05", TODAY))).toBe("2026-10-31");
  });
  it("next available: four weeks from the day", () => {
    expect(homeWindow("next-available", TODAY)).toEqual({ from: TODAY, days: FIRST_LOOK_DAYS });
  });
  it("windowEnd is the last day inside the window", () => {
    expect(windowEnd({ from: "2026-09-02", days: 7 })).toBe("2026-09-08");
  });
});

describe("shiftWindow", () => {
  it("week list pages by seven days and clamps back to today; nothing before today", () => {
    expect(shiftWindow("week-list", { from: "2026-09-09", days: 7 }, 1, TODAY)).toEqual({ from: "2026-09-16", days: 7 });
    expect(shiftWindow("week-list", { from: "2026-09-05", days: 7 }, -1, TODAY)).toEqual({ from: TODAY, days: 7 });
    expect(shiftWindow("week-list", { from: TODAY, days: 7 }, -1, TODAY)).toBeNull();
  });
  it("week columns page by whole weeks; nothing before this week", () => {
    expect(shiftWindow("week-columns", { from: "2026-08-31", days: 7 }, 1, TODAY)).toEqual({ from: "2026-09-07", days: 7 });
    expect(shiftWindow("week-columns", { from: "2026-09-07", days: 7 }, -1, TODAY)).toEqual({ from: "2026-08-31", days: 7 });
    expect(shiftWindow("week-columns", { from: "2026-08-31", days: 7 }, -1, TODAY)).toBeNull();
  });
  it("calendar pages by month; back to this month lands on today, never earlier", () => {
    expect(shiftWindow("calendar", { from: TODAY, days: 29 }, 1, TODAY)).toEqual({ from: "2026-10-01", days: 31 });
    expect(shiftWindow("calendar", { from: "2026-10-01", days: 31 }, -1, TODAY)).toEqual({ from: TODAY, days: 29 });
    expect(shiftWindow("calendar", { from: TODAY, days: 29 }, -1, TODAY)).toBeNull();
  });
  it("next available moves four weeks at a time and only forward from today", () => {
    expect(shiftWindow("next-available", { from: TODAY, days: 28 }, 1, TODAY)).toEqual({ from: "2026-09-30", days: 28 });
    expect(shiftWindow("next-available", { from: "2026-09-30", days: 28 }, -1, TODAY)).toEqual({ from: TODAY, days: 28 });
    expect(shiftWindow("next-available", { from: TODAY, days: 28 }, -1, TODAY)).toBeNull();
  });
});

describe("firstDayBeyond — the first look's jump", () => {
  const w = { from: TODAY, days: 7 };
  it("the first look spans four pages, within getSlots' 31-day cap", () => {
    expect(FIRST_LOOK_DAYS).toBe(28);
    expect(FIRST_LOOK_DAYS).toBeLessThanOrEqual(31);
  });
  it("stays put when the window already has a free time", () => {
    expect(firstDayBeyond(["2026-09-15T09:00:00.000Z", "2026-09-04T09:00:00.000Z"], w, dayOf)).toBeNull();
  });
  it("jumps to the day of the earliest free time beyond an empty window", () => {
    expect(firstDayBeyond(["2026-09-20T09:00:00.000Z", "2026-09-15T09:00:00.000Z"], w, dayOf)).toBe("2026-09-15");
  });
  it("has nowhere to go when nothing is free at all", () => {
    expect(firstDayBeyond([], w, dayOf)).toBeNull();
  });
  it("ignores slots before the window — a stale earlier time never pulls the visitor backwards", () => {
    expect(firstDayBeyond(["2026-08-30T09:00:00.000Z", "2026-09-15T09:00:00.000Z"], w, dayOf)).toBe("2026-09-15");
  });
});

describe("relativeDayLabel", () => {
  it("names today and tomorrow, nothing else", () => {
    expect(relativeDayLabel(TODAY, TODAY)).toBe("today");
    expect(relativeDayLabel("2026-09-03", TODAY)).toBe("tomorrow");
    expect(relativeDayLabel("2026-09-04", TODAY)).toBeNull();
    expect(relativeDayLabel("2026-09-01", TODAY)).toBeNull();
  });
});

describe("firstLookDays — the first fetch after a pick", () => {
  it("spans four weeks, or the whole home window when that is longer, within getSlots' 31-day cap", () => {
    expect(firstLookDays({ from: "2026-09-02", days: 7 })).toBe(28);
    expect(firstLookDays({ from: "2026-09-02", days: 29 })).toBe(29);
    expect(firstLookDays({ from: "2026-10-01", days: 31 })).toBe(31);
  });
});
