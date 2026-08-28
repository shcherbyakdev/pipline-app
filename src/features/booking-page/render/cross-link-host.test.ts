import { describe, it, expect } from "vitest";
import { crossLinkHost } from "./cross-link-host";
import { DEFAULT_PAGE, newSection } from "../defaults";
import type { Section } from "../schema";

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const hero = { ...newSection("hero", "hero0001"), headline: "Hi" } as Section;
const about = newSection("about", "about001");

describe("crossLinkHost (spec 2026-08-28 §3.5)", () => {
  it("the first section hosts it when it is a header or a hero", () => {
    expect(crossLinkHost([header, booking])).toEqual({ sectionId: header.id, placement: "header" });
    expect(crossLinkHost([hero, about, booking])).toEqual({ sectionId: "hero0001", placement: "hero" });
  });
  it("otherwise the booking section hosts it, above the widget", () => {
    expect(crossLinkHost([about, booking])).toEqual({ sectionId: booking.id, placement: "booking" });
    expect(crossLinkHost([about, header, booking])).toEqual({ sectionId: booking.id, placement: "booking" });
  });
  it("is total: no sections, no host", () => {
    expect(crossLinkHost([])).toBeNull();
    expect(crossLinkHost([about])).toBeNull();
  });
});
