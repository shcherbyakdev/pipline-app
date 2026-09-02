import { describe, it, expect } from "vitest";
import { initialStarterState, isFreshPage, starterReducer } from "./starter-state";
import { DEFAULT_PAGE, newSection } from "../defaults";

const edited = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, newSection("about", "about001"), DEFAULT_PAGE.sections[1]!] };

describe("isFreshPage (widget templates spec §5)", () => {
  it("fresh = never published, the untouched default composition, and no widget layout chosen yet", () => {
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: null }, false)).toBe(true);
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: null }, true)).toBe(false);
    expect(isFreshPage({ draft: edited, published: null }, false)).toBe(false);
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: DEFAULT_PAGE }, false)).toBe(false);
  });
});

describe("starterReducer (widget templates spec §5)", () => {
  const start = initialStarterState("layout");
  it("starts on the given step with nothing chosen", () => {
    expect(start).toEqual({ step: "layout", layout: null, stayLayout: null });
    expect(initialStarterState("firstItem")).toEqual({ step: "firstItem", layout: null, stayLayout: null });
  });
  it("choosing goes to firstItem when the channel has nothing bookable, else straight to done — a spaces page may pick both groups at once", () => {
    expect(starterReducer(start, { kind: "choose", layout: "calendar", stayLayout: null, needsFirstItem: true })).toEqual({ layout: "calendar", stayLayout: null, step: "firstItem" });
    expect(starterReducer(start, { kind: "choose", layout: "week-columns", stayLayout: "fields", needsFirstItem: false })).toEqual({ layout: "week-columns", stayLayout: "fields", step: "done" });
    expect(starterReducer(start, { kind: "choose", layout: null, stayLayout: "next-free", needsFirstItem: false })).toEqual({ layout: null, stayLayout: "next-free", step: "done" });
  });
  it("created moves firstItem to done; back returns to layout keeping the choice; both are no-ops elsewhere", () => {
    const waiting = starterReducer(start, { kind: "choose", layout: "calendar", stayLayout: null, needsFirstItem: true });
    expect(starterReducer(waiting, { kind: "created" })).toEqual({ ...waiting, step: "done" });
    expect(starterReducer(waiting, { kind: "back" })).toEqual({ ...waiting, step: "layout" });
    expect(starterReducer(start, { kind: "created" })).toEqual(start);
    expect(starterReducer(start, { kind: "back" })).toEqual(start);
  });
  it("a spaces starter that opened on firstItem has no layout step to go back to", () => {
    const spaces = initialStarterState("firstItem");
    expect(starterReducer(spaces, { kind: "back" })).toEqual(spaces);
    expect(starterReducer(spaces, { kind: "created" })).toEqual({ ...spaces, step: "done" });
  });
});
