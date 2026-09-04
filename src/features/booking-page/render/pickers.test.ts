import { describe, it, expect } from "vitest";
import { DEFAULT_PAGE, newSection } from "../defaults";
import type { PageDocument } from "../schema";
import { bookHref, pickersOnPage } from "./pickers";

const HAS_ALL = { serviceCount: 2, staffCount: 2, offeringCount: 2 };
const [header, booking] = DEFAULT_PAGE.sections as [PageDocument["sections"][number], PageDocument["sections"][number]];
const page = (...extra: PageDocument["sections"]): PageDocument => ({ ...DEFAULT_PAGE, sections: [header, ...extra, booking] });

describe("pickersOnPage", () => {
  it("a visible Services section with services on it is the page's service picker", () => {
    expect(pickersOnPage(page(newSection("services")), HAS_ALL)).toEqual({ services: true, spaces: false, staff: false });
    expect(pickersOnPage(page(newSection("spaces")), HAS_ALL)).toEqual({ services: false, spaces: true, staff: false });
    expect(pickersOnPage(page(newSection("services"), newSection("spaces")), HAS_ALL)).toEqual({ services: true, spaces: true, staff: false });
  });

  it("a hidden or empty catalogue section is not a picker — the public page drops it, so the widget must list", () => {
    const hiddenServices = { ...newSection("services"), hidden: true } as PageDocument["sections"][number];
    expect(pickersOnPage(page(hiddenServices), HAS_ALL)).toEqual({ services: false, spaces: false, staff: false });
    expect(pickersOnPage(page(newSection("services")), { ...HAS_ALL, serviceCount: 0 })).toEqual({ services: false, spaces: false, staff: false });
    expect(pickersOnPage(page(newSection("spaces")), { ...HAS_ALL, offeringCount: 0 })).toEqual({ services: false, spaces: false, staff: false });
    // A solo org's Team section is dropped too, so the widget keeps its switch.
    expect(pickersOnPage(page(newSection("staff")), { ...HAS_ALL, staffCount: 1 })).toEqual({ services: false, spaces: false, staff: false });
  });

  it("a visible Team section is the page's person picker — the widget drops its own switch", () => {
    expect(pickersOnPage(page(newSection("staff")), HAS_ALL)).toEqual({ services: false, spaces: false, staff: true });
  });

  it("the default page has none: the widget is the picker", () => {
    expect(pickersOnPage(DEFAULT_PAGE, HAS_ALL)).toEqual({ services: false, spaces: false, staff: false });
  });
});

describe("bookHref", () => {
  it("the cover's Book button goes to the first step of booking: the catalogue section when there is one, else the widget", () => {
    expect(bookHref({ services: true, spaces: false, staff: false })).toBe("#services");
    expect(bookHref({ services: true, spaces: true, staff: false })).toBe("#services");
    expect(bookHref({ services: false, spaces: true, staff: false })).toBe("#spaces");
    // The team is not a step of its own: picking a person is optional.
    expect(bookHref({ services: false, spaces: false, staff: true })).toBe("#book");
  });
});
