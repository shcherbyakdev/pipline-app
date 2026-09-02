import { describe, it, expect } from "vitest";
import { stayFetchWindow } from "./stay-window";

describe("stayFetchWindow — what the stays picker fetches for the months it shows", () => {
  it("one month, no start picked: that month plus the turnover tail", () => {
    expect(stayFetchWindow({ shown: "2026-09", months: 1, start: null, turnoverDays: 0 })).toEqual({ from: "2026-09-01", days: 30 });
    expect(stayFetchWindow({ shown: "2026-09", months: 1, start: null, turnoverDays: 2 })).toEqual({ from: "2026-09-01", days: 32 });
  });
  it("two months: both, like the picker always fetched", () => {
    expect(stayFetchWindow({ shown: "2026-09", months: 2, start: null, turnoverDays: 0 })).toEqual({ from: "2026-09-01", days: 61 });
  });
  it("a check-in picked in an earlier month is kept in the window, so the check-out month can still validate the stay", () => {
    expect(stayFetchWindow({ shown: "2026-10", months: 1, start: "2026-09-29", turnoverDays: 0 })).toEqual({ from: "2026-09-01", days: 61 });
    expect(stayFetchWindow({ shown: "2026-10", months: 1, start: "2026-10-03", turnoverDays: 0 })).toEqual({ from: "2026-10-01", days: 31 });
  });
  it("never exceeds the action's 93-day cap", () => {
    expect(stayFetchWindow({ shown: "2026-12", months: 2, start: "2026-09-29", turnoverDays: 5 }).days).toBe(93);
  });
});
