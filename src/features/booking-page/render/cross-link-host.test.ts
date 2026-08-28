import { describe, it, expect } from "vitest";
import { crossLinkHost } from "./cross-link-host";
import { publicSections } from "../doc-ops";
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

describe("crossLinkHost through publicSections (hidden-first-section contract)", () => {
  const counts = { serviceCount: 0, staffCount: 0, offeringCount: 0 };

  it("a hidden hero is dropped publicly — the next visible section (header) hosts it", () => {
    const hiddenHero = { ...newSection("hero", "hero0001"), headline: "Hi", hidden: true } as Section;
    const doc = { ...DEFAULT_PAGE, sections: [hiddenHero, header, booking] };
    expect(crossLinkHost(publicSections(doc, counts))).toEqual({ sectionId: header.id, placement: "header" });
  });
  it("an empty hero (not hidden: no headline/subheadline/image) is dropped publicly too — the booking section hosts it", () => {
    const emptyHero = newSection("hero", "hero0002") as Section;
    const doc = { ...DEFAULT_PAGE, sections: [emptyHero, booking] };
    expect(crossLinkHost(publicSections(doc, counts))).toEqual({ sectionId: booking.id, placement: "booking" });
  });
});
