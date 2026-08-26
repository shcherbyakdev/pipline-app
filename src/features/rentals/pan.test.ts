import { describe, it, expect } from "vitest";
import { panStep, panDays, PAN_THRESHOLD_PX } from "./pan";

describe("panDays (a release moves the window by the whole days dragged)", () => {
  it("dragging left (negative dx) moves forward in time, to the nearest day", () => {
    expect(panDays(-100, 32)).toBe(3);
    expect(panDays(-15, 32)).toBe(0);
    expect(panDays(-16, 32)).toBe(1);
    expect(panDays(200, 56)).toBe(-4);
  });
  it("an unmeasured column is no movement", () => {
    expect(panDays(-100, 0)).toBe(0);
  });
});

const start = { x: 100, y: 50, left: 300, top: 40 };

describe("panStep (dragging the chart scrolls it the other way)", () => {
  it("a jitter below the threshold is not a drag — the click still lands", () => {
    expect(panStep(start, { x: 102, y: 51 }, PAN_THRESHOLD_PX)).toEqual({ dragging: false, left: 300, top: 40 });
  });
  it("past the threshold the scroll position follows the pointer, inverted", () => {
    expect(panStep(start, { x: 60, y: 50 }, PAN_THRESHOLD_PX)).toEqual({ dragging: true, left: 340, top: 40 });
    expect(panStep(start, { x: 130, y: 70 }, PAN_THRESHOLD_PX)).toEqual({ dragging: true, left: 270, top: 20 });
  });
  it("never scrolls to a negative offset", () => {
    expect(panStep({ ...start, left: 10, top: 5 }, { x: 200, y: 200 }, PAN_THRESHOLD_PX)).toEqual({ dragging: true, left: 0, top: 0 });
  });
});
