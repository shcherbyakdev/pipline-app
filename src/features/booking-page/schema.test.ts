import { describe, it, expect } from "vitest";
import { pageDocumentSchema, parsePageDocument, allowedLinkUrl, PAGE_LIMITS, type PageDocument } from "./schema";
import { DEFAULT_PAGE, newSection, newSectionId, ADDABLE_TYPES, SECTION_META } from "./defaults";

const ORG = "123e4567-e89b-12d3-a456-426614174000";
const IMG = `${ORG}/page/abcdef0123456789.png`;
const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;

describe("pageDocumentSchema", () => {
  it("cover: the Book button label is optional, so pages stored before it existed still parse", () => {
    const legacyHero: Record<string, unknown> = { ...newSection("hero"), id: "hero0001" };
    delete legacyHero.cta;
    expect(legacyHero).not.toHaveProperty("cta");
    const parsed = parsePageDocument({ ...DEFAULT_PAGE, sections: [header, legacyHero, booking] }, ORG);
    expect(parsed).not.toBeNull();
    expect(parsed!.sections[1]).not.toHaveProperty("cta");
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...legacyHero, cta: "Book now" }, booking] }).success).toBe(true);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...legacyHero, cta: "x".repeat(41) }, booking] }).success).toBe(false);
  });
  it("a cover added from the palette starts with a Book button", () => {
    const hero = newSection("hero");
    expect(hero.type === "hero" && hero.cta).toBe("Book now");
  });
  it("accepts DEFAULT_PAGE and a new section of every addable type", () => {
    expect(pageDocumentSchema.safeParse(DEFAULT_PAGE).success).toBe(true);
    const doc: PageDocument = { ...DEFAULT_PAGE, sections: [header, ...ADDABLE_TYPES.filter((t) => t !== "header").map((t) => newSection(t)), booking] };
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
  });
  it("requires exactly one booking section", () => {
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header] }).success).toBe(false);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, booking, { ...booking, id: "booking2" }] }).success).toBe(false);
  });
  it("booking can never be hidden", () => {
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...booking, hidden: true }] }).success).toBe(false);
  });
  it("rejects duplicate single-instance types and duplicate ids", () => {
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...header, id: "header02" }, booking] }).success).toBe(false);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...newSection("hero"), id: header.id }, booking] }).success).toBe(false);
  });
  it("caps sections at 20 and images at 24", () => {
    const heroes = Array.from({ length: 19 }, () => newSection("hero"));
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, ...heroes, booking] }).success).toBe(false);
    const gallery = { ...newSection("gallery"), images: Array.from({ length: 12 }, () => ({ path: IMG, alt: "" })) };
    const gallery2 = { ...gallery, id: newSectionId() };
    const hero = { ...newSection("hero"), imagePath: IMG };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, gallery2, booking] }).success).toBe(true);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, gallery2, hero, booking] }).success).toBe(false);
  });
  it("enforces text limits and image path shape", () => {
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [{ ...header, tagline: "x".repeat(121) }, booking] }).success).toBe(false);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...newSection("hero"), imagePath: "https://evil/x.png" }, booking] }).success).toBe(false);
  });
  it("link urls: https only, tel: for phone, mailto: for email, empty allowed", () => {
    expect(allowedLinkUrl("https://instagram.com/me", "instagram")).toBe(true);
    expect(allowedLinkUrl("http://instagram.com/me", "instagram")).toBe(false);
    expect(allowedLinkUrl("javascript:alert(1)", "other")).toBe(false);
    expect(allowedLinkUrl("tel:+48 600 000 000", "phone")).toBe(true);
    expect(allowedLinkUrl("tel:+48 600 000 000", "website")).toBe(false);
    expect(allowedLinkUrl("mailto:me@example.com", "email")).toBe(true);
    expect(allowedLinkUrl("", "email")).toBe(true);
    const links = { ...newSection("links"), items: [{ label: "IG", url: "http://x", icon: "instagram" as const }] };
    const res = pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, links, booking] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.path).toEqual(["sections", 1, "items", 0, "url"]);
  });
  it("location mapsUrl must be https or empty", () => {
    const loc = { ...newSection("location"), mapsUrl: "ftp://maps" };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, loc, booking] }).success).toBe(false);
  });
  it("PAGE_LIMITS are the spec's numbers", () => {
    expect(PAGE_LIMITS).toEqual({ sections: 20, images: 24, bytes: 65_536 });
  });
  it("spaces: a live section with per-offering photos, single-instance, one photo per space", () => {
    const OFFERING = "11111111-2222-4333-8444-555555555555";
    expect(newSection("spaces")).toMatchObject({ type: "spaces", title: "Spaces", style: "cards", showPrices: true, showStay: true, photos: [] });
    const spaces = { ...newSection("spaces"), photos: [{ offeringId: OFFERING, path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, spaces, booking] }).success).toBe(true);
    expect(ADDABLE_TYPES).toContain("spaces");
    expect(SECTION_META.spaces.label).toBe("Spaces");
    // one per page
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, spaces, { ...spaces, id: newSectionId() }, booking] }).success).toBe(false);
    // offeringId must be a uuid (the canned preview offering never gets a photo row)
    const bad = { ...spaces, photos: [{ offeringId: "preview-offering", path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, bad, booking] }).success).toBe(false);
    // one photo per space
    const dup = { ...spaces, photos: [{ offeringId: OFFERING, path: IMG }, { offeringId: OFFERING, path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, dup, booking] }).success).toBe(false);
    // at most 12 photos, and they count toward the 24-image page cap
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ offeringId: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`, path: IMG }));
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...spaces, photos: many(13) }, booking] }).success).toBe(false);
    const gallery = { ...newSection("gallery"), images: Array.from({ length: 12 }, () => ({ path: IMG, alt: "" })) };
    const hero = { ...newSection("hero"), imagePath: IMG };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, { ...spaces, photos: many(12) }, booking] }).success).toBe(true);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, { ...spaces, photos: many(12) }, hero, booking] }).success).toBe(false);
  });
});

describe("parsePageDocument", () => {
  it("returns the document for valid input", () => {
    expect(parsePageDocument(DEFAULT_PAGE, ORG)).toEqual(DEFAULT_PAGE);
  });
  it("returns null for junk, wrong version, and a foreign org's image path", () => {
    expect(parsePageDocument(null, ORG)).toBeNull();
    expect(parsePageDocument("x", ORG)).toBeNull();
    expect(parsePageDocument({ ...DEFAULT_PAGE, version: 2 }, ORG)).toBeNull();
    const foreign = { ...newSection("hero"), imagePath: `00000000-0000-0000-0000-000000000000/page/abcdef0123456789.png` };
    expect(parsePageDocument({ ...DEFAULT_PAGE, sections: [header, foreign, booking] }, ORG)).toBeNull();
    const own = { ...newSection("hero"), imagePath: IMG };
    expect(parsePageDocument({ ...DEFAULT_PAGE, sections: [header, own, booking] }, ORG)).not.toBeNull();
  });
});

describe("defaults", () => {
  it("newSectionId matches the id rule", () => {
    for (let i = 0; i < 20; i++) expect(newSectionId()).toMatch(/^[a-z0-9]{6,12}$/);
  });
  it("DEFAULT_PAGE is header + booking with stable ids", () => {
    expect(DEFAULT_PAGE.sections.map((s) => [s.type, s.id])).toEqual([["header", "header01"], ["booking", "booking1"]]);
  });
  it("every section type has meta copy", () => {
    for (const t of [...ADDABLE_TYPES, "booking"] as const) expect(SECTION_META[t].label.length).toBeGreaterThan(0);
  });
});
