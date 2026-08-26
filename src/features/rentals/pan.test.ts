import { describe, it, expect } from "vitest";
import { panStep, PAN_THRESHOLD_PX } from "./pan";

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
