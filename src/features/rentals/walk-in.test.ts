import { describe, it, expect } from "vitest";
import { walkInOfferings } from "./walk-in";

const nights = { id: "n", name: "Test", active: true, rangeMode: "nights" as const };
const hours = { id: "h", name: "Rehearsal Room", active: true, rangeMode: "hours" as const };
const retired = { id: "r", name: "Old cabin", active: false, rangeMode: "nights" as const };

describe("walkInOfferings", () => {
  it("lists every active offering — a nights offering is bookable from the week view, not only hourly ones", () => {
    expect(walkInOfferings([hours, nights]).map((o) => o.id)).toEqual(["h", "n"]);
  });

  it("drops inactive offerings", () => {
    expect(walkInOfferings([nights, retired]).map((o) => o.id)).toEqual(["n"]);
  });

  it("keeps the caller's order", () => {
    expect(walkInOfferings([nights, hours]).map((o) => o.id)).toEqual(["n", "h"]);
  });
});
