import { z } from "zod";
import { PAGE_IMAGE_PATH_RE, imagePathsIn } from "./images";

export const PAGE_LIMITS = { sections: 20, images: 24, bytes: 65_536 } as const;

export const SECTION_TYPES = [
  "header", "hero", "about", "services", "staff", "spaces", "gallery", "testimonials", "faq", "links", "location", "booking",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** Types that make no sense twice on one page. */
export const SINGLE_INSTANCE_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["header", "booking", "services", "staff", "spaces"]);

export const LINK_ICONS = ["instagram", "facebook", "tiktok", "whatsapp", "website", "phone", "email", "other"] as const;
export type LinkIcon = (typeof LINK_ICONS)[number];

export const HTTPS_RE = /^https:\/\/\S+$/;
const TEL_RE = /^tel:\+?[0-9 ()-]{3,30}$/;
const MAILTO_RE = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Empty is allowed while a draft is incomplete (the item then renders nothing). */
export function allowedLinkUrl(url: string, icon: LinkIcon): boolean {
  if (url === "") return true;
  if (icon === "phone") return TEL_RE.test(url);
  if (icon === "email") return MAILTO_RE.test(url);
  return HTTPS_RE.test(url);
}

const id = z.string().regex(/^[a-z0-9]{6,12}$/);
const text = (max: number) => z.string().max(max);
const imagePath = z.string().regex(PAGE_IMAGE_PATH_RE);
const base = { id, hidden: z.boolean() };

export const headerSection = z.object({ ...base, type: z.literal("header"), tagline: text(120) });
// `cta`: the Book button's label — a link to the widget (#book). Optional,
// not defaulted: pages stored before it existed must keep parsing, and a
// failed parse silently reverts a published page to DEFAULT_PAGE.
export const heroSection = z.object({
  ...base, type: z.literal("hero"), imagePath: imagePath.optional(), headline: text(80), subheadline: text(160),
  align: z.enum(["left", "center"]), cta: text(40).optional(),
});
export const aboutSection = z.object({ ...base, type: z.literal("about"), title: text(60), body: text(2000), photoPath: imagePath.optional() });
export const servicesSection = z.object({
  ...base, type: z.literal("services"), title: text(60), style: z.enum(["list", "cards"]), showPrices: z.boolean(), showDurations: z.boolean(),
});
export const staffSection = z.object({ ...base, type: z.literal("staff"), title: text(60) });
/** H5a: the org's rental offerings as cards. Photos live here, keyed by
    offering id (no column on rental_offerings); the offerings themselves
    come from RenderContext at render time. */
export const spacesSection = z.object({
  ...base, type: z.literal("spaces"), title: text(60), style: z.enum(["list", "cards"]), showPrices: z.boolean(), showStay: z.boolean(),
  photos: z.array(z.object({ offeringId: z.string().uuid(), path: imagePath })).max(12),
});
export const gallerySection = z.object({
  ...base, type: z.literal("gallery"), images: z.array(z.object({ path: imagePath, alt: text(120) })).max(12),
  columns: z.union([z.literal(2), z.literal(3)]),
});
export const testimonialsSection = z.object({
  ...base, type: z.literal("testimonials"), items: z.array(z.object({ quote: text(300), author: text(60) })).max(6),
});
export const faqSection = z.object({ ...base, type: z.literal("faq"), items: z.array(z.object({ q: text(120), a: text(600) })).max(10) });
const linkItem = z
  .object({ label: text(40), url: z.string().max(500), icon: z.enum(LINK_ICONS) })
  .refine((i) => allowedLinkUrl(i.url, i.icon), { message: "httpsLink", path: ["url"] });
export const linksSection = z.object({ ...base, type: z.literal("links"), items: z.array(linkItem).max(8) });
export const locationSection = z.object({
  ...base, type: z.literal("location"), address: text(300),
  mapsUrl: z.string().max(500).refine((u) => u === "" || HTTPS_RE.test(u), { message: "httpsOnly" }),
});
// `hidden: false` literal: the widget is always on the page.
export const bookingSection = z.object({ ...base, type: z.literal("booking"), title: text(60), hidden: z.literal(false) });

// Issue messages are KEYS under `studio.issues` (the schema runs client-side,
// synchronously, with no translator in reach); doc-ops' issuesBySection
// resolves them. "onlyOne:<type>" carries the section type after the colon.
export type IssueKey = "httpsLink" | "httpsOnly" | "oneBooking" | "onlyOne" | "onePhotoPerSpace" | "uniqueIds" | "tooManyImages";

export const sectionSchema = z.discriminatedUnion("type", [
  headerSection, heroSection, aboutSection, servicesSection, staffSection, spacesSection, gallerySection, testimonialsSection,
  faqSection, linksSection, locationSection, bookingSection,
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

export const pageDocumentSchema = z
  .object({
    version: z.literal(1),
    layout: z.enum(["column", "split"]),
    sections: z.array(sectionSchema).min(1).max(PAGE_LIMITS.sections),
  })
  .superRefine((doc, ctx) => {
    const count = (t: SectionType) => doc.sections.filter((s) => s.type === t).length;
    const issue = (message: `${IssueKey}${string}`) => ctx.addIssue({ code: "custom", path: ["sections"], message });
    if (count("booking") !== 1) issue("oneBooking");
    for (const t of SINGLE_INSTANCE_TYPES) {
      if (count(t) > 1) issue(`onlyOne:${t}`);
    }
    for (const s of doc.sections) {
      if (s.type === "spaces" && new Set(s.photos.map((p) => p.offeringId)).size !== s.photos.length) issue("onePhotoPerSpace");
    }
    if (new Set(doc.sections.map((s) => s.id)).size !== doc.sections.length) issue("uniqueIds");
    if (imagePathsIn(doc).length > PAGE_LIMITS.images) issue("tooManyImages");
  });
export type PageDocument = z.infer<typeof pageDocumentSchema>;

/** Tolerant read of a stored document: null on any shape problem or an image
    path outside this org's prefix — the caller falls back to DEFAULT_PAGE. */
export function parsePageDocument(raw: unknown, orgId: string): PageDocument | null {
  const parsed = pageDocumentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const prefix = `${orgId}/page/`;
  if (!imagePathsIn(parsed.data).every((p) => p.startsWith(prefix))) return null;
  return parsed.data;
}

