import { describe, it, expect } from "vitest";
import {
  isSectionEmpty, publicSections, emptyVisibleSections, canAddSection, insertSection, removeSection, moveSection,
  replaceSection, setSectionHidden, sectionSummary, deepEqual, hasUnpublishedChanges, issuesBySection,
} from "./doc-ops";
import { DEFAULT_PAGE, EN_SEED, newSection } from "./defaults";
import { pageDocumentSchema, type Section } from "./schema";
import { enTranslator, translatorFor } from "@/i18n/test-translator";

const t = enTranslator("studio");
const ctx = { serviceCount: 2, staffCount: 1, offeringCount: 1 };
const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;

describe("isSectionEmpty", () => {
  it("header and booking are never empty", () => {
    expect(isSectionEmpty(header, ctx)).toBe(false);
    expect(isSectionEmpty(booking, ctx)).toBe(false);
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
    expect(sectionSummary({ ...(spaces as Extract<Section, { type: "spaces" }>), style: "list" }, t)).toBe("List");
    expect(sectionSummary(spaces, t)).toBe("Cards");
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
});

describe("canAddSection / insertSection", () => {
  it("refuses a second single-instance section and a 21st section", () => {
    expect(canAddSection(DEFAULT_PAGE, "header", t)).toEqual({ ok: false, reason: "Already on the page." });
    expect(canAddSection(DEFAULT_PAGE, "hero", t).ok).toBe(true);
    const full = { ...DEFAULT_PAGE, sections: [header, ...Array.from({ length: 18 }, () => newSection("hero")), booking] };
    expect(canAddSection(full, "hero", t)).toEqual({ ok: false, reason: "Pages hold at most 20 sections." });
  });
  it("inserts after the given id, or at the end, and returns the new id", () => {
    const a = insertSection(DEFAULT_PAGE, "hero", header.id, EN_SEED);
    expect(a.doc.sections.map((s) => s.type)).toEqual(["header", "hero", "booking"]);
    expect(a.doc.sections[1]!.id).toBe(a.id);
    const b = insertSection(DEFAULT_PAGE, "faq", null, EN_SEED);
    expect(b.doc.sections.map((s) => s.type)).toEqual(["header", "booking", "faq"]);
    expect(pageDocumentSchema.safeParse(b.doc).success).toBe(true);
  });
  it("seeds the new section's words in the org's language, not the admin's", () => {
    const tSeed = translatorFor("uk", "public.seed");
    const seed = { bookNow: tSeed("bookNow"), services: tSeed("services"), team: tSeed("team"), spaces: tSeed("spaces") };
    const hero = insertSection(DEFAULT_PAGE, "hero", null, seed).doc.sections[2] as Extract<Section, { type: "hero" }>;
    expect(hero.cta).toBe("Забронювати");
    const services = insertSection(DEFAULT_PAGE, "services", null, seed).doc.sections[2] as Extract<Section, { type: "services" }>;
    expect(services.title).toBe("Послуги");
  });
});

describe("remove / move / replace / hide", () => {
  const hero = newSection("hero", "hero0001") as Extract<Section, { type: "hero" }>;
  const doc = { ...DEFAULT_PAGE, sections: [header, hero, booking] };
  it("removeSection drops by id but never the booking section", () => {
    expect(removeSection(doc, hero.id).sections.map((s) => s.type)).toEqual(["header", "booking"]);
    expect(removeSection(doc, booking.id)).toBe(doc);
    expect(removeSection(doc, "nope").sections).toHaveLength(3);
  });
  it("moveSection puts `from` at `to`'s position", () => {
    expect(moveSection(doc, hero.id, header.id).sections.map((s) => s.type)).toEqual(["hero", "header", "booking"]);
    expect(moveSection(doc, header.id, booking.id).sections.map((s) => s.type)).toEqual(["hero", "booking", "header"]);
    expect(moveSection(doc, hero.id, hero.id)).toBe(doc);
  });
  it("replaceSection swaps by id; setSectionHidden refuses the booking section", () => {
    const next = replaceSection(doc, { ...hero, headline: "New" } as Extract<Section, { type: "hero" }>);
    expect(next.sections[1]).toEqual({ ...hero, headline: "New" });
    expect(setSectionHidden(doc, hero.id, true).sections[1]!.hidden).toBe(true);
    expect(setSectionHidden(doc, booking.id, true)).toBe(doc);
  });
});

describe("sectionSummary", () => {
  it("describes each section in one line", () => {
    expect(sectionSummary(header, t)).toBe("Logo and name");
    expect(sectionSummary({ ...header, tagline: "Hair & colour" } as Extract<Section, { type: "header" }>, t)).toBe("Hair & colour");
    expect(sectionSummary({ ...newSection("gallery") as Extract<Section, { type: "gallery" }>, images: [{ path: "p", alt: "" }] }, t)).toBe("1 image");
    expect(sectionSummary(newSection("faq") as Extract<Section, { type: "faq" }>, t)).toBe("0 questions");
    expect(sectionSummary({ ...newSection("location") as Extract<Section, { type: "location" }>, address: "Main St 1\nWarsaw" }, t)).toBe("Main St 1");
    expect(sectionSummary(newSection("faq") as Extract<Section, { type: "faq" }>, translatorFor("uk", "studio"))).toBe("0 запитань");
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
    expect(issuesBySection(doc, res.error.issues, t)).toEqual({
      links001: { "items.0.url": "Use an https:// link (tel: for phone, mailto: for email)." },
    });
  });
  it("keys a page-level issue under '' and names the section in the admin's words", () => {
    const doc = { ...DEFAULT_PAGE, sections: [header, { ...booking, id: "booking2" } as Extract<Section, { type: "booking" }>, booking] };
    const res = pageDocumentSchema.safeParse(doc);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(issuesBySection(doc, res.error.issues, t)[""]?.["sections"]).toContain("exactly one booking");
    const staffed = { ...DEFAULT_PAGE, sections: [header, newSection("staff", "staff001"), newSection("staff", "staff002"), booking] };
    const dup = pageDocumentSchema.safeParse(staffed);
    if (dup.success) return;
    expect(issuesBySection(staffed, dup.error.issues, t)[""]?.["sections"]).toBe("Only one Team section is allowed.");
  });
});
