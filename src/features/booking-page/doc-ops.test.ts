import { describe, it, expect } from "vitest";
import {
  isSectionEmpty, publicSections, emptyVisibleSections, canAddSection, insertSection, removeSection, moveSection,
  replaceSection, setSectionHidden, sectionSummary, deepEqual, hasUnpublishedChanges, issuesBySection,
  coveredChannels, splitBookingSection, canRemoveSection, canHideSection,
} from "./doc-ops";
import { DEFAULT_PAGE, newSection, newBookingSection, sectionLabel } from "./defaults";
import { pageDocumentSchema, type Section } from "./schema";

const ctx = { serviceCount: 2, staffCount: 1, offeringCount: 1 };
const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;

describe("isSectionEmpty", () => {
  it("header and the combined booking section are never empty; a per-channel one is empty without its channel", () => {
    expect(isSectionEmpty(header, ctx)).toBe(false);
    expect(isSectionEmpty(booking, ctx)).toBe(false);
    expect(isSectionEmpty(booking, { serviceCount: 0, staffCount: 1, offeringCount: 0 })).toBe(false);
    const appts = newBookingSection("appointments");
    const spaces = newBookingSection("spaces");
    expect(isSectionEmpty(appts, ctx)).toBe(false);
    expect(isSectionEmpty(appts, { ...ctx, serviceCount: 0 })).toBe(true);
    expect(isSectionEmpty(spaces, ctx)).toBe(false);
    expect(isSectionEmpty(spaces, { ...ctx, offeringCount: 0 })).toBe(true);
  });
  it("text sections are empty until something is written or an image set", () => {
    const hero = newSection("hero") as Extract<Section, { type: "hero" }>;
    expect(isSectionEmpty(hero, ctx)).toBe(true);
    expect(isSectionEmpty({ ...hero, headline: "  " }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...hero, headline: "Hi" }, ctx)).toBe(false);
    // The Book button is not content: a cover with only a button stays empty.
    expect(isSectionEmpty({ ...hero, cta: "Book now" }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...hero, imagePath: "o/page/a.png" }, ctx)).toBe(false);
    const faq = newSection("faq") as Extract<Section, { type: "faq" }>;
    expect(isSectionEmpty(faq, ctx)).toBe(true);
    expect(isSectionEmpty({ ...faq, items: [{ q: "Q", a: "" }] }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...faq, items: [{ q: "Q", a: "A" }] }, ctx)).toBe(false);
    const links = newSection("links") as Extract<Section, { type: "links" }>;
    expect(isSectionEmpty({ ...links, items: [{ label: "IG", url: "", icon: "instagram" }] }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...links, items: [{ label: "IG", url: "https://x", icon: "instagram" }] }, ctx)).toBe(false);
  });
  it("live sections depend on the org", () => {
    expect(isSectionEmpty(newSection("services"), { serviceCount: 0, staffCount: 1, offeringCount: 1 })).toBe(true);
    expect(isSectionEmpty(newSection("staff"), { serviceCount: 1, staffCount: 1, offeringCount: 1 })).toBe(true);
    expect(isSectionEmpty(newSection("staff"), { serviceCount: 1, staffCount: 2, offeringCount: 1 })).toBe(false);
  });
  it("spaces is empty only when the org has no active offering", () => {
    const spaces = newSection("spaces");
    expect(isSectionEmpty(spaces, ctx)).toBe(false);
    expect(isSectionEmpty(spaces, { ...ctx, offeringCount: 0 })).toBe(true);
    expect(sectionSummary({ ...(spaces as Extract<Section, { type: "spaces" }>), style: "list" })).toBe("List");
    expect(sectionSummary(spaces)).toBe("Cards");
  });
});

describe("publicSections / emptyVisibleSections", () => {
  const hero = { ...newSection("hero") as Extract<Section, { type: "hero" }>, headline: "Hi" };
  const emptyFaq = newSection("faq") as Extract<Section, { type: "faq" }>;
  const hiddenAbout = { ...newSection("about") as Extract<Section, { type: "about" }>, title: "Me", hidden: true };
  const doc = { ...DEFAULT_PAGE, sections: [header, hero, emptyFaq, hiddenAbout, booking] };
  it("drops hidden and empty sections, keeps order", () => {
    expect(publicSections(doc, ctx).map((s) => s.type)).toEqual(["header", "hero", "booking"]);
  });
  it("lists visible-but-empty sections for the publish warning", () => {
    expect(emptyVisibleSections(doc, ctx).map((s) => s.type)).toEqual(["faq"]);
  });
  it("a Services / Spaces cards section with no visible booking widget for its channel leads nowhere — dropped, and flagged", () => {
    const services = newSection("services", "svc00001");
    const spacesCards = newSection("spaces", "spc00001");
    const onlySpacesWidget = { ...DEFAULT_PAGE, sections: [header, services, spacesCards, newBookingSection("spaces", "bookspcs")] };
    expect(publicSections(onlySpacesWidget, ctx).map((s) => s.id)).toEqual([header.id, "spc00001", "bookspcs"]);
    expect(emptyVisibleSections(onlySpacesWidget, ctx).map((s) => s.id)).toEqual(["svc00001"]);
    const hiddenAppts = { ...newBookingSection("appointments", "bookappt"), hidden: true };
    const bothButOneHidden = { ...DEFAULT_PAGE, sections: [header, services, spacesCards, hiddenAppts, newBookingSection("spaces", "bookspcs")] };
    expect(publicSections(bothButOneHidden, ctx).map((s) => s.id)).toEqual([header.id, "spc00001", "bookspcs"]);
    const combined = { ...DEFAULT_PAGE, sections: [header, services, spacesCards, booking] };
    expect(publicSections(combined, ctx).map((s) => s.id)).toEqual([header.id, "svc00001", "spc00001", booking.id]);
  });
});

describe("coveredChannels", () => {
  it("what the visible booking sections can book", () => {
    expect(coveredChannels(DEFAULT_PAGE)).toEqual({ appointments: true, spaces: true });
    const appts = newBookingSection("appointments", "bookappt");
    const spaces = newBookingSection("spaces", "bookspcs");
    expect(coveredChannels({ ...DEFAULT_PAGE, sections: [header, appts] })).toEqual({ appointments: true, spaces: false });
    expect(coveredChannels({ ...DEFAULT_PAGE, sections: [header, appts, spaces] })).toEqual({ appointments: true, spaces: true });
    expect(coveredChannels({ ...DEFAULT_PAGE, sections: [header, { ...appts, hidden: true }, spaces] })).toEqual({ appointments: false, spaces: true });
  });
});

describe("splitBookingSection", () => {
  it("replaces the combined widget with one per channel, in place, keeping its id and title for appointments", () => {
    const titled = { ...booking, title: "Book a time" } as Extract<Section, { type: "booking" }>;
    const doc = { ...DEFAULT_PAGE, sections: [header, titled, newSection("links", "links001")] };
    const next = splitBookingSection(doc, titled.id);
    expect(next.sections.map((s) => s.type)).toEqual(["header", "booking", "booking", "links"]);
    const [, a, b] = next.sections as Array<Extract<Section, { type: "booking" }>>;
    expect(a).toMatchObject({ id: titled.id, channel: "appointments", title: "Book a time", hidden: false });
    expect(b).toMatchObject({ channel: "spaces", title: "Book a time", hidden: false });
    expect(b!.id).not.toBe(a!.id);
    expect(pageDocumentSchema.safeParse(next).success).toBe(true);
  });
  it("does nothing to a section that is not the combined widget", () => {
    const appts = newBookingSection("appointments", "bookappt");
    const doc = { ...DEFAULT_PAGE, sections: [header, appts, newBookingSection("spaces", "bookspcs")] };
    expect(splitBookingSection(doc, "bookappt")).toBe(doc);
    expect(splitBookingSection(DEFAULT_PAGE, header.id)).toBe(DEFAULT_PAGE);
  });
});

describe("sectionLabel", () => {
  it("names the per-channel widgets; everything else keeps its catalogue label", () => {
    expect(sectionLabel(booking)).toBe("Booking");
    expect(sectionLabel(newBookingSection("appointments"))).toBe("Book appointments");
    expect(sectionLabel(newBookingSection("spaces"))).toBe("Book spaces");
    expect(sectionLabel(header)).toBe("Header");
  });
});

describe("canAddSection / insertSection", () => {
  it("refuses a second single-instance section and a 21st section", () => {
    expect(canAddSection(DEFAULT_PAGE, "header").ok).toBe(false);
    expect(canAddSection(DEFAULT_PAGE, "hero").ok).toBe(true);
    const full = { ...DEFAULT_PAGE, sections: [header, ...Array.from({ length: 18 }, () => newSection("hero")), booking] };
    expect(canAddSection(full, "hero").ok).toBe(false);
  });
  it("a per-channel booking section can be added only while its channel has no widget at all", () => {
    // The combined widget covers both: split it first.
    expect(canAddSection(DEFAULT_PAGE, "booking", "appointments")).toEqual({ ok: false, reason: "Split the Booking section first." });
    expect(canAddSection(DEFAULT_PAGE, "booking", "spaces").ok).toBe(false);
    expect(canAddSection(DEFAULT_PAGE, "booking").ok).toBe(false);
    const apptsOnly = { ...DEFAULT_PAGE, sections: [header, newBookingSection("appointments", "bookappt")] };
    expect(canAddSection(apptsOnly, "booking", "spaces").ok).toBe(true);
    expect(canAddSection(apptsOnly, "booking", "appointments")).toEqual({ ok: false, reason: "Already on the page." });
    expect(canAddSection(apptsOnly, "booking").ok).toBe(false);
    // Hidden still counts: two spaces widgets would be an invalid page.
    const hiddenSpaces = { ...DEFAULT_PAGE, sections: [header, newBookingSection("appointments", "bookappt"), { ...newBookingSection("spaces", "bookspcs"), hidden: true }] };
    expect(canAddSection(hiddenSpaces, "booking", "spaces").ok).toBe(false);
  });
  it("insertSection with a channel creates that booking widget", () => {
    const apptsOnly = { ...DEFAULT_PAGE, sections: [header, newBookingSection("appointments", "bookappt")] };
    const out = insertSection(apptsOnly, "booking", null, undefined, "spaces");
    expect(out.doc.sections.at(-1)).toMatchObject({ type: "booking", channel: "spaces", id: out.id });
    expect(pageDocumentSchema.safeParse(out.doc).success).toBe(true);
  });
  it("inserts after the given id, or at the end, and returns the new id", () => {
    const a = insertSection(DEFAULT_PAGE, "hero", header.id);
    expect(a.doc.sections.map((s) => s.type)).toEqual(["header", "hero", "booking"]);
    expect(a.doc.sections[1]!.id).toBe(a.id);
    const b = insertSection(DEFAULT_PAGE, "faq", null);
    expect(b.doc.sections.map((s) => s.type)).toEqual(["header", "booking", "faq"]);
    expect(pageDocumentSchema.safeParse(b.doc).success).toBe(true);
  });
});

describe("remove / move / replace / hide", () => {
  const hero = newSection("hero", "hero0001") as Extract<Section, { type: "hero" }>;
  const doc = { ...DEFAULT_PAGE, sections: [header, hero, booking] };
  it("removeSection drops by id but never the last visible booking section", () => {
    expect(removeSection(doc, hero.id).sections.map((s) => s.type)).toEqual(["header", "booking"]);
    expect(removeSection(doc, booking.id)).toBe(doc);
    expect(canRemoveSection(doc, booking.id).ok).toBe(false);
    expect(canRemoveSection(doc, hero.id).ok).toBe(true);
    expect(removeSection(doc, "nope").sections).toHaveLength(3);
    const appts = newBookingSection("appointments", "bookappt");
    const spaces = newBookingSection("spaces", "bookspcs");
    const two = { ...DEFAULT_PAGE, sections: [header, appts, spaces] };
    expect(canRemoveSection(two, "bookappt").ok).toBe(true);
    expect(removeSection(two, "bookappt").sections.map((s) => s.id)).toEqual([header.id, "bookspcs"]);
    const otherHidden = { ...DEFAULT_PAGE, sections: [header, appts, { ...spaces, hidden: true }] };
    expect(canRemoveSection(otherHidden, "bookappt").ok).toBe(false);
    expect(removeSection(otherHidden, "bookappt")).toBe(otherHidden);
  });
  it("moveSection puts `from` at `to`'s position", () => {
    expect(moveSection(doc, hero.id, header.id).sections.map((s) => s.type)).toEqual(["hero", "header", "booking"]);
    expect(moveSection(doc, header.id, booking.id).sections.map((s) => s.type)).toEqual(["hero", "booking", "header"]);
    expect(moveSection(doc, hero.id, hero.id)).toBe(doc);
  });
  it("replaceSection swaps by id; setSectionHidden refuses to hide the last visible booking section", () => {
    const next = replaceSection(doc, { ...hero, headline: "New" } as Extract<Section, { type: "hero" }>);
    expect(next.sections[1]).toEqual({ ...hero, headline: "New" });
    expect(setSectionHidden(doc, hero.id, true).sections[1]!.hidden).toBe(true);
    expect(setSectionHidden(doc, booking.id, true)).toBe(doc);
    expect(canHideSection(doc, booking.id).ok).toBe(false);
    const appts = newBookingSection("appointments", "bookappt");
    const spaces = newBookingSection("spaces", "bookspcs");
    const two = { ...DEFAULT_PAGE, sections: [header, appts, spaces] };
    expect(canHideSection(two, "bookappt").ok).toBe(true);
    const hid = setSectionHidden(two, "bookappt", true);
    expect(hid.sections[1]!.hidden).toBe(true);
    expect(canHideSection(hid, "bookspcs").ok).toBe(false);
    expect(setSectionHidden(hid, "bookspcs", true)).toBe(hid);
    // Unhiding is always fine.
    expect(setSectionHidden(hid, "bookappt", false).sections[1]!.hidden).toBe(false);
  });
});

describe("sectionSummary", () => {
  it("describes each section in one line", () => {
    expect(sectionSummary(header)).toBe("Logo and name");
    expect(sectionSummary({ ...header, tagline: "Hair & colour" } as Extract<Section, { type: "header" }>)).toBe("Hair & colour");
    expect(sectionSummary({ ...newSection("gallery") as Extract<Section, { type: "gallery" }>, images: [{ path: "p", alt: "" }] })).toBe("1 image");
    expect(sectionSummary(newSection("faq") as Extract<Section, { type: "faq" }>)).toBe("0 questions");
    expect(sectionSummary({ ...newSection("location") as Extract<Section, { type: "location" }>, address: "Main St 1\nWarsaw" })).toBe("Main St 1");
    expect(sectionSummary(newBookingSection("spaces"))).toBe("The booking widget for your spaces.");
    expect(sectionSummary({ ...newBookingSection("appointments"), title: "Book a slot" })).toBe("Book a slot");
  });
});

describe("deepEqual / hasUnpublishedChanges", () => {
  it("is structural and ignores key order and undefined keys", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
  it("never-published counts as unpublished; equal docs do not", () => {
    expect(hasUnpublishedChanges(DEFAULT_PAGE, null)).toBe(true);
    expect(hasUnpublishedChanges(DEFAULT_PAGE, JSON.parse(JSON.stringify(DEFAULT_PAGE)))).toBe(false);
    expect(hasUnpublishedChanges({ ...DEFAULT_PAGE, layout: "split" }, DEFAULT_PAGE)).toBe(true);
  });
});

describe("issuesBySection", () => {
  it("keys a field issue by section id with a relative path", () => {
    const links = { ...newSection("links", "links001") as Extract<Section, { type: "links" }>, items: [{ label: "x", url: "http://x", icon: "instagram" as const }] };
    const doc = { ...DEFAULT_PAGE, sections: [header, links, booking] };
    const res = pageDocumentSchema.safeParse(doc);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(issuesBySection(doc, res.error.issues)).toEqual({
      links001: { "items.0.url": "Use an https:// link (tel: for phone, mailto: for email)." },
    });
  });
  it("keys a page-level issue under ''", () => {
    const doc = { ...DEFAULT_PAGE, sections: [header, { ...booking, id: "booking2" } as Extract<Section, { type: "booking" }>, booking] };
    const res = pageDocumentSchema.safeParse(doc);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(issuesBySection(doc, res.error.issues)[""]?.["sections"]).toContain("booking section");
  });
});
