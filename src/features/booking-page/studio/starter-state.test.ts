import { describe, it, expect } from "vitest";
import { initialStarterState, isFreshPage, skinDefault, starterReducer } from "./starter-state";
import { DEFAULT_PAGE, newSection } from "../defaults";
import { BUSINESS_TYPES } from "../business-types";

const salon = BUSINESS_TYPES.find((t) => t.id === "salon")!;
const edited = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, newSection("about", "about001"), DEFAULT_PAGE.sections[1]!] };

describe("isFreshPage (spec §5.1)", () => {
  it("fresh = never published and the untouched default composition", () => {
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: null })).toBe(true);
    expect(isFreshPage({ draft: edited, published: null })).toBe(false);
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: DEFAULT_PAGE })).toBe(false);
    expect(isFreshPage({ draft: edited, published: edited })).toBe(false);
  });
});

describe("skinDefault (spec §5.3)", () => {
  it("on when nothing is published anywhere in the org, off otherwise", () => {
    expect(skinDefault(false)).toBe(true);
    expect(skinDefault(true)).toBe(false);
  });
});

describe("starterReducer (spec §5.3)", () => {
  const start = initialStarterState({ applyLook: true });
  it("starts on the type step with the given look default", () => {
    expect(start).toEqual({ step: "type", type: null, applyLook: true });
  });
  it("choosing a type goes to firstItem when the channel has nothing bookable, else straight to done", () => {
    expect(starterReducer(start, { kind: "choose", type: salon, needsFirstItem: true })).toEqual({ ...start, type: salon, step: "firstItem" });
    expect(starterReducer(start, { kind: "choose", type: salon, needsFirstItem: false })).toEqual({ ...start, type: salon, step: "done" });
  });
  it("created moves firstItem to done; back returns to type keeping the choice; both are no-ops elsewhere", () => {
    const waiting = starterReducer(start, { kind: "choose", type: salon, needsFirstItem: true });
    expect(starterReducer(waiting, { kind: "created" })).toEqual({ ...waiting, step: "done" });
    expect(starterReducer(waiting, { kind: "back" })).toEqual({ ...waiting, step: "type" });
    expect(starterReducer(start, { kind: "created" })).toEqual(start);
    expect(starterReducer(start, { kind: "back" })).toEqual(start);
  });
  it("toggling the look never changes the step", () => {
    expect(starterReducer(start, { kind: "toggleLook", value: false })).toEqual({ ...start, applyLook: false });
  });
});
