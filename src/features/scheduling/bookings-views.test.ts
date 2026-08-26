import { describe, it, expect } from "vitest";
import { viewSwitcherItems } from "./bookings-views";

describe("viewSwitcherItems (spec §2 — the same three words from every view)", () => {
  it("week, timeline, list — in that order, with the current one flagged", () => {
    const items = viewSwitcherItems({ current: "timeline", showTimeline: true });
    expect(items.map((i) => i.label)).toEqual(["Week", "Timeline", "List"]);
    expect(items.map((i) => i.href)).toEqual(["/bookings", "/bookings?view=timeline", "/bookings?view=list"]);
    expect(items.map((i) => i.current)).toEqual([false, true, false]);
  });
  it("drops Timeline when the org has no nights/days space", () => {
    expect(viewSwitcherItems({ current: "list", showTimeline: false }).map((i) => i.label)).toEqual(["Week", "List"]);
  });
  it("week and list carry the scope; the timeline (spaces by nature) drops it", () => {
    const items = viewSwitcherItems({ current: "week", showTimeline: true, scopeQuery: "show=spaces" });
    expect(items[0].href).toBe("/bookings?show=spaces");
    expect(items[1].href).toBe("/bookings?view=timeline");
    expect(items[2].href).toBe("/bookings?view=list&show=spaces");
  });
});
