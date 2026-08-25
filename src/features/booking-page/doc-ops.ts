// Pure operations on a page document. Everything the studio and the public
// renderer decide lives here so it can be unit-tested without React
// (bookable.ts doctrine).
import { PAGE_LIMITS, SINGLE_INSTANCE_TYPES, type PageDocument, type Section, type SectionType } from "./schema";
import { newSection, SECTION_META } from "./defaults";

export type EmptyContext = { serviceCount: number; staffCount: number; offeringCount: number };

/** Nothing to show: every text/image prop blank, or (live sections) no data. */
export function isSectionEmpty(section: Section, ctx: EmptyContext): boolean {
  switch (section.type) {
    case "header":
    case "booking":
      return false;
    case "hero":
      return !section.headline.trim() && !section.subheadline.trim() && !section.imagePath;
    case "about":
      return !section.title.trim() && !section.body.trim() && !section.photoPath;
    case "services":
      return ctx.serviceCount === 0;
    case "staff":
      return ctx.staffCount < 2;
    case "spaces":
      return ctx.offeringCount === 0;
    case "gallery":
      return section.images.length === 0;
    case "testimonials":
      return !section.items.some((i) => i.quote.trim());
    case "faq":
      return !section.items.some((i) => i.q.trim() && i.a.trim());
    case "links":
      return !section.items.some((i) => i.label.trim() && i.url.trim());
    case "location":
      return !section.address.trim() && !section.mapsUrl.trim();
  }
}

/** What the public page shows: not hidden, not empty, in order. */
export function publicSections(doc: PageDocument, ctx: EmptyContext): Section[] {
  return doc.sections.filter((s) => !s.hidden && !isSectionEmpty(s, ctx));
}

/** Visible-but-empty sections — the Publish warning. */
export function emptyVisibleSections(doc: PageDocument, ctx: EmptyContext): Section[] {
  return doc.sections.filter((s) => !s.hidden && isSectionEmpty(s, ctx));
}

export function canAddSection(doc: PageDocument, type: SectionType): { ok: true } | { ok: false; reason: string } {
  if (doc.sections.length >= PAGE_LIMITS.sections) {
    return { ok: false, reason: `Pages hold at most ${PAGE_LIMITS.sections} sections.` };
  }
  if (SINGLE_INSTANCE_TYPES.has(type) && doc.sections.some((s) => s.type === type)) {
    return { ok: false, reason: "Already on the page." };
  }
  return { ok: true };
}

/** Insert after `afterId` (or at the end). Returns the new doc and the new section's id. */
export function insertSection(doc: PageDocument, type: SectionType, afterId: string | null, id?: string): { doc: PageDocument; id: string } {
  const section = newSection(type, id);
  const at = afterId ? doc.sections.findIndex((s) => s.id === afterId) : -1;
  const sections = [...doc.sections];
  sections.splice(at === -1 ? sections.length : at + 1, 0, section);
  return { doc: { ...doc, sections }, id: section.id };
}

export function removeSection(doc: PageDocument, id: string): PageDocument {
  const target = doc.sections.find((s) => s.id === id);
  if (!target || target.type === "booking") return doc;
  return { ...doc, sections: doc.sections.filter((s) => s.id !== id) };
}

/** Move `fromId` to the position `toId` occupies (dnd-kit's over-target semantics). */
export function moveSection(doc: PageDocument, fromId: string, toId: string): PageDocument {
  const from = doc.sections.findIndex((s) => s.id === fromId);
  const to = doc.sections.findIndex((s) => s.id === toId);
  if (from === -1 || to === -1 || from === to) return doc;
  const sections = [...doc.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(to, 0, moved!);
  return { ...doc, sections };
}

export function replaceSection(doc: PageDocument, next: Section): PageDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.id === next.id ? next : s)) };
}

export function setSectionHidden(doc: PageDocument, id: string, hidden: boolean): PageDocument {
  const target = doc.sections.find((s) => s.id === id);
  if (!target || target.type === "booking") return doc;
  return replaceSection(doc, { ...target, hidden });
}

/** One line under the type label in the sections list. */
export function sectionSummary(section: Section): string {
  const one = (s: string, fallback: string) => (s.trim() ? s.trim() : fallback);
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  switch (section.type) {
    case "header": return one(section.tagline, "Logo and name");
    case "hero": return one(section.headline, "No headline yet");
    case "about": return one(section.title, one(section.body.split("\n")[0] ?? "", "Nothing written yet"));
    case "services": return section.style === "cards" ? "Cards" : "List";
    case "staff": return "Bookable team members";
    case "spaces": return section.style === "cards" ? "Cards" : "List";
    case "gallery": return n(section.images.length, "image");
    case "testimonials": return n(section.items.filter((i) => i.quote.trim()).length, "quote");
    case "faq": return n(section.items.filter((i) => i.q.trim()).length, "question");
    case "links": return n(section.items.filter((i) => i.label.trim() && i.url.trim()).length, "link");
    case "location": return one(section.address.split("\n")[0] ?? "", "No address yet");
    case "booking": return one(section.title, SECTION_META.booking.description);
  }
}

/** Structural equality for plain JSON. jsonb reorders object keys, so a
    string comparison of draft vs published is not enough; undefined keys
    (an unset imagePath) compare equal to absent ones. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
  const kb = Object.keys(ob).filter((k) => ob[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(oa[k], ob[k]));
}

export function hasUnpublishedChanges(draft: PageDocument, published: PageDocument | null): boolean {
  return published === null || !deepEqual(draft, published);
}

/** zod issues keyed by section id → relative field path ("headline",
    "items.2.url"); page-level issues under "". First message per field wins. */
export type IssueMap = Record<string, Record<string, string>>;
export function issuesBySection(
  doc: PageDocument,
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): IssueMap {
  const out: IssueMap = {};
  for (const issue of issues) {
    const [root, index, ...rest] = issue.path;
    const section = root === "sections" && typeof index === "number" ? doc.sections[index] : undefined;
    const key = section ? section.id : "";
    const field = section ? rest.map(String).join(".") : issue.path.map(String).join(".");
    const bucket = (out[key] ??= {});
    bucket[field] ??= issue.message;
  }
  return out;
}
