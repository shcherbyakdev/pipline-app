import { describe, it, expect } from "vitest";
import { numberedUnitName, withUnit } from "./unit-label";

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

describe("numberedUnitName", () => {
  it("numbers the item", () => {
    expect(numberedUnitName("ARRI lamp", 2)).toBe("ARRI lamp 2");
  });
  it("keeps a 200-char name inside rental_units_name_len", () => {
    const long = "L".repeat(200);
    const name = numberedUnitName(long, 12);
    expect(name.length).toBe(200);
    expect(name.endsWith(" 12")).toBe(true);
  });
});
