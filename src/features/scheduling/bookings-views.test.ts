import { describe, it, expect } from "vitest";
import { viewSwitcherItems } from "./bookings-views";

describe("viewSwitcherItems (spec §2 — the same words from every view)", () => {
  it("day, week, month, timeline — in that order, with the current one flagged", () => {
    const items = viewSwitcherItems({ current: "timeline", showTimeline: true });
    expect(items.map((i) => i.view)).toEqual(["day", "week", "month", "timeline"]);
    expect(items.map((i) => i.href)).toEqual([
      "/bookings?view=day",
      "/bookings",
      "/bookings?view=month",
      "/bookings?view=timeline",
    ]);
    expect(items.map((i) => i.current)).toEqual([false, false, false, true]);
  });
  it("drops Timeline when the org has no space at all", () => {
    expect(viewSwitcherItems({ current: "month", showTimeline: false }).map((i) => i.view)).toEqual([
      "day",
      "week",
      "month",
    ]);
  });
  it("every view carries the scope — the timeline too, now that hourly rooms live there", () => {
    const items = viewSwitcherItems({ current: "week", showTimeline: true, scopeQuery: "show=spaces" });
    expect(items.map((i) => i.href)).toEqual([
      "/bookings?view=day&show=spaces",
      "/bookings?show=spaces",
      "/bookings?view=month&show=spaces",
      "/bookings?view=timeline&show=spaces",
    ]);
  });
});
