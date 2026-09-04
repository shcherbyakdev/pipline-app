import { describe, expect, it } from "vitest";
import { staffOffers } from "./staff-offers";

const map = { haircut: ["ana", "bo"], colour: ["ana"] };

describe("staffOffers", () => {
  it("answers from the map", () => {
    expect(staffOffers(map, "haircut", "bo")).toBe(true);
    expect(staffOffers(map, "colour", "bo")).toBe(false);
  });

  it("treats an unknown service as nobody's", () => {
    expect(staffOffers(map, "massage", "ana")).toBe(false);
  });

  it("without a map, everyone takes everything", () => {
    expect(staffOffers(undefined, "massage", "ana")).toBe(true);
  });
});
