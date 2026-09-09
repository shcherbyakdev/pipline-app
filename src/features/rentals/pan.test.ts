import { describe, it, expect } from "vitest";
import { bufferWindow, settledColumn, visibleOffset } from "./pan";

describe("bufferWindow (a window before and after the visible one, so scrolling always has real days under the hand)", () => {
  it("starts one window early and spans three", () => {
    expect(bufferWindow("2027-05-15", 14)).toEqual({ bufferFrom: "2027-05-01", cols: 42 });
  });
  it("visibleOffset is where the visible window starts inside the buffer, in columns", () => {
    expect(visibleOffset("2027-05-01", "2027-05-15")).toBe(14);
    expect(visibleOffset("2027-05-01", "2027-05-01")).toBe(0);
  });
});

describe("settledColumn (a scroll that stops between two days lands on the nearer one)", () => {
  it("rounds to the nearest column, never negative, 0 when unmeasured", () => {
    expect(settledColumn(119, 40)).toBe(3);
    expect(settledColumn(121, 40)).toBe(3);
    expect(settledColumn(-5, 40)).toBe(0);
    expect(settledColumn(300, 0)).toBe(0);
  });
});
