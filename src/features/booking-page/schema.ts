import { z } from "zod";
import { PAGE_IMAGE_PATH_RE, imagePathsIn } from "./images";

export const PAGE_LIMITS = { sections: 20, images: 24, bytes: 65_536 } as const;

export const SECTION_TYPES = [
  "header", "hero", "about", "services", "staff", "gallery", "testimonials", "faq", "links", "location", "booking",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** Types that make no sense twice on one page. */
export const SINGLE_INSTANCE_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["header", "booking", "services", "staff"]);

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
export const heroSection = z.object({
  ...base, type: z.literal("hero"), imagePath: imagePath.optional(), headline: text(80), subheadline: text(160),
  align: z.enum(["left", "center"]),
});
export const aboutSection = z.object({ ...base, type: z.literal("about"), title: text(60), body: text(2000), photoPath: imagePath.optional() });
export const servicesSection = z.object({
  ...base, type: z.literal("services"), title: text(60), style: z.enum(["list", "cards"]), showPrices: z.boolean(), showDurations: z.boolean(),
});
export const staffSection = z.object({ ...base, type: z.literal("staff"), title: text(60) });
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
  .refine((i) => allowedLinkUrl(i.url, i.icon), { message: "Use an https:// link (tel: for phone, mailto: for email).", path: ["url"] });
export const linksSection = z.object({ ...base, type: z.literal("links"), items: z.array(linkItem).max(8) });
export const locationSection = z.object({
  ...base, type: z.literal("location"), address: text(300),
  mapsUrl: z.string().max(500).refine((u) => u === "" || HTTPS_RE.test(u), { message: "Use an https:// link." }),
});
// `hidden: false` literal: the widget is always on the page.
export const bookingSection = z.object({ ...base, type: z.literal("booking"), title: text(60), hidden: z.literal(false) });

export const sectionSchema = z.discriminatedUnion("type", [
  headerSection, heroSection, aboutSection, servicesSection, staffSection, gallerySection, testimonialsSection,
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
    if (count("booking") !== 1) ctx.addIssue({ code: "custom", path: ["sections"], message: "The page needs exactly one booking section." });
    for (const t of SINGLE_INSTANCE_TYPES) {
      if (count(t) > 1) ctx.addIssue({ code: "custom", path: ["sections"], message: `Only one ${t} section is allowed.` });
    }
    if (new Set(doc.sections.map((s) => s.id)).size !== doc.sections.length) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "Section ids must be unique." });
    }
    if (imagePathsIn(doc).length > PAGE_LIMITS.images) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: `At most ${PAGE_LIMITS.images} images per page.` });
    }
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

// Named refusals (a "use server" module may only export async functions, so
// the copy lives here — the orgs/schema.ts precedent).
export const PAGE_TOO_LARGE_ERROR = "This page is too large to save — remove some content or images.";
export const IMAGE_REJECTED_ERROR = "Use a PNG, JPEG or WebP image under 5 MB.";
export const PAGE_GATED_ERROR = "Some sections on this page need a higher plan. Hide or remove them to publish.";
