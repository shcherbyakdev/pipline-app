import { describe, it, expect } from "vitest";
import { withUnit } from "./unit-label";

/* A single-unit space's unit is named after the space, so "Flat · Flat" is
   the label a client used to get. The unit only earns a mention when it says
   something the space's name doesn't. */
describe("withUnit", () => {
  it("names the unit when it differs from the space", () => {
    expect(withUnit("Studio", "Room 2")).toBe("Studio · Room 2");
  });
  it("drops a unit named after its space", () => {
    expect(withUnit("Flat", "Flat")).toBe("Flat");
  });
  it("drops a missing unit", () => {
    expect(withUnit("Flat", null)).toBe("Flat");
  });
});
