import { describe, it, expect } from "vitest";
import { FIRST_LOOK_DAYS, PAGE_DAYS, firstPageWithSlots, shiftDays } from "./slot-paging";

// Day-key the slots by their UTC date so the tests don't depend on the
// machine's zone; the widget passes its viewer-local formatter instead.
const utcDay = (iso: string) => iso.slice(0, 10);
const at = (day: string, hh = "09") => `${day}T${hh}:00:00.000Z`;

describe("shiftDays", () => {
  it("adds calendar days across month and year ends", () => {
    expect(shiftDays("2026-08-27", 7)).toBe("2026-09-03");
    expect(shiftDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("firstPageWithSlots", () => {
  it("the first look spans four pages, within getSlots' 31-day cap", () => {
    expect(PAGE_DAYS).toBe(7);
    expect(FIRST_LOOK_DAYS).toBe(4 * PAGE_DAYS);
    expect(FIRST_LOOK_DAYS).toBeLessThanOrEqual(31);
  });

  it("stays put when the current page already has a free time", () => {
    expect(firstPageWithSlots([at("2026-08-30")], "2026-08-27", utcDay)).toBeNull();
    // the page is fromDate + 6 inclusive
    expect(firstPageWithSlots([at("2026-09-02")], "2026-08-27", utcDay)).toBeNull();
  });

  it("jumps to the day of the earliest free time beyond an empty page", () => {
    const slots = [at("2026-09-15"), at("2026-09-10", "14"), at("2026-09-10", "10"), at("2026-09-20")];
    expect(firstPageWithSlots(slots, "2026-08-27", utcDay)).toBe("2026-09-10");
  });

  it("has nowhere to go when nothing is free at all", () => {
    expect(firstPageWithSlots([], "2026-08-27", utcDay)).toBeNull();
  });

  it("ignores slots before the page — a stale earlier time never pulls the visitor backwards", () => {
    expect(firstPageWithSlots([at("2026-08-01"), at("2026-09-12")], "2026-08-27", utcDay)).toBe("2026-09-12");
    expect(firstPageWithSlots([at("2026-08-01")], "2026-08-27", utcDay)).toBeNull();
  });
});
