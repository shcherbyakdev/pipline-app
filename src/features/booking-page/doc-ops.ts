// Pure operations on a page document. Everything the studio and the public
// renderer decide lives here so it can be unit-tested without React
// (bookable.ts doctrine).
import type { Translator } from "@/i18n/translator";
import { PAGE_LIMITS, SINGLE_INSTANCE_TYPES, type IssueKey, type PageDocument, type Section, type SectionType } from "./schema";
import { newSection, type SectionSeed } from "./defaults";

/** The studio's words (`studio.*`) — every line a helper here composes. */
export type StudioT = Translator<"studio">;

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

export function canAddSection(doc: PageDocument, type: SectionType, t: StudioT): { ok: true } | { ok: false; reason: string } {
  if (doc.sections.length >= PAGE_LIMITS.sections) {
    return { ok: false, reason: t("addRefused.max", { max: PAGE_LIMITS.sections }) };
  }
  if (SINGLE_INSTANCE_TYPES.has(type) && doc.sections.some((s) => s.type === type)) {
    return { ok: false, reason: t("addRefused.alreadyOn") };
  }
  return { ok: true };
}

/** Insert after `afterId` (or at the end), seeded in the org's language.
    Returns the new doc and the new section's id. */
export function insertSection(
  doc: PageDocument, type: SectionType, afterId: string | null, seed: SectionSeed, id?: string,
): { doc: PageDocument; id: string } {
  const section = newSection(type, id, seed);
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
export function sectionSummary(section: Section, t: StudioT): string {
  const one = (s: string, fallback: string) => (s.trim() ? s.trim() : fallback);
  const style = (s: "list" | "cards") => (s === "cards" ? t("forms.cards") : t("forms.list"));
  switch (section.type) {
    case "header": return one(section.tagline, t("summary.header"));
    case "hero": return one(section.headline, t("summary.noHeadline"));
    case "about": return one(section.title, one(section.body.split("\n")[0] ?? "", t("summary.nothingWritten")));
    case "services": return style(section.style);
    case "staff": return t("summary.staff");
    case "spaces": return style(section.style);
    case "gallery": return t("summary.images", { count: section.images.length });
    case "testimonials": return t("summary.quotes", { count: section.items.filter((i) => i.quote.trim()).length });
    case "faq": return t("summary.questions", { count: section.items.filter((i) => i.q.trim()).length });
    case "links": return t("summary.links", { count: section.items.filter((i) => i.label.trim() && i.url.trim()).length });
    case "location": return one(section.address.split("\n")[0] ?? "", t("summary.noAddress"));
    case "booking": return one(section.title, t("sections.booking.description"));
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

/** A schema issue's message is a `studio.issues` key (schema.ts), possibly
    "onlyOne:<type>"; anything else (zod's own wording for a limit the UI
    prevents anyway) passes through. */
export function issueMessage(raw: string, t: StudioT): string {
  const [key, arg] = raw.split(":") as [IssueKey, string | undefined];
  switch (key) {
    case "onlyOne": return t("issues.onlyOne", { section: t(`sections.${arg as SectionType}.label`) });
    case "tooManyImages": return t("issues.tooManyImages", { max: PAGE_LIMITS.images });
    case "httpsLink":
    case "httpsOnly":
    case "oneBooking":
    case "onePhotoPerSpace":
    case "uniqueIds":
      return t(`issues.${key}`);
    default: return raw;
  }
}

/** zod issues keyed by section id → relative field path ("headline",
    "items.2.url"); page-level issues under "". First message per field
    wins, already in the admin's words. */
export type IssueMap = Record<string, Record<string, string>>;
export function issuesBySection(
  doc: PageDocument,
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  t: StudioT,
): IssueMap {
  const out: IssueMap = {};
  for (const issue of issues) {
    const [root, index, ...rest] = issue.path;
    const section = root === "sections" && typeof index === "number" ? doc.sections[index] : undefined;
    const key = section ? section.id : "";
    const field = section ? rest.map(String).join(".") : issue.path.map(String).join(".");
    const bucket = (out[key] ??= {});
    bucket[field] ??= issueMessage(issue.message, t);
  }
  return out;
}
