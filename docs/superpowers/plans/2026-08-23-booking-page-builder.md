# Booking Page Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixed `/book/[handle]` composition into a page made of typed, reorderable sections with six starter templates, edited in the Booking page studio as a draft and published explicitly.

**Architecture:** A `booking_pages` row per org holds `draft` and `published` jsonb documents (`{ version: 1, layout, sections[] }`, zod discriminated union). One `PageRenderer` serves the public pages, the studio preview and template thumbnails; every decision (empty-section rule, reorder ops, validation, metadata, orphan diff, gating) lives in a pure `.ts` module with a Vitest test, and the React components stay thin. Writes go through three security-definer RPCs; the public renderer never trusts jsonb (safeParse → default composition).

**Tech Stack:** Next.js (App Router, RSC + server actions), Supabase (Postgres RLS, storage, definer RPCs), Drizzle migrations, zod v4, Tailwind v4 (container queries), Base UI (`Dialog`, `Popover`, `Checkbox`), `@dnd-kit/*` (new), Vitest (unit: node env, `*.test.ts` only; integration: local Supabase).

**Spec:** `docs/superpowers/specs/2026-08-23-booking-page-builder-design.md`

## Global Constraints

- Migrations: **0047** = `npx drizzle-kit generate` from `src/db/schema/booking-pages.ts`; **0048** = `npx drizzle-kit generate --custom --name=booking_pages_security`. Custom SQL is idempotent (`drop … if exists`, `create or replace`); every new table gets `revoke all … from public, anon, authenticated, service_role;` then targeted grants; `anon` receives nothing. Definer RPCs: `language plpgsql security definer set search_path = ''`, membership via `p_org_id not in (select public.user_orgs())`, sentinel `raise exception 'not found'`, then `revoke all on function … ; grant execute … to authenticated;`. End the file with `notify pgrst, 'reload schema';`.
- Server actions: signature `(input: unknown): Promise<ActionState>`, `safeParse` failures return `{ ok: false, error: GENERIC_WRITE_ERROR }` (never zod's message), a local `fail(context, error)` logs `[booking-page] ${context}:` via `console.error`. Named refusals are exported constants from `schema.ts` (a `"use server"` file may export only async functions). Org resolution = local `currentOrgId()` (RLS-scoped `orgs` select). RPC sentinels matched with `isRpcSentinel` (equality).
- Client idiom: `React.useState` + `React.useTransition` + `sonner` `toast`; **no react-hook-form** (installed, unused — do not start). Base UI triggers use `render={<Button … />}` (no `asChild`). Selects are raw `<select>` with the repo's class string (copied in `fields.tsx`). No `Tabs`/`Switch`/confirm primitives exist — this plan adds feature-local ones.
- Tests: unit tests are `*.test.ts` beside the module, relative imports, `describe/it/expect` from vitest; there is **no component testing** (no jsdom, `.tsx` tests are not collected). Integration tests are `*.integration.test.ts`, module-local `signedInUser`, org via the `create_org` RPC, read-back via the service-role `admin` client.
- Document limits (spec): ≤20 sections, ≤24 image references, ≤64 KB serialized, exactly one `booking` section (never hidden/deleted), single-instance types `header`, `booking`, `services`, `staff`. Text limits per field as in the section catalogue. Optional text props are stored as `""`; `imagePath`/`photoPath` are omitted when unset.
- Image paths: `{orgId}/page/{sha256:16}.{jpg|png|webp}` in the public `branding` bucket; raster only, magic-byte checked, 5 MB cap. URLs resolve with the pure `pageImageUrl(supabaseUrl, path)`.
- Copy: "Booking page" (the product noun), "Publish", "Discard changes", "Unpublished changes", "Not published yet", "Start from a template". Icons: `lucide-react` in the studio (`GripVertical`, `Eye`, `EyeOff`, `Trash2`, `Plus`, `ChevronUp`, `ChevronDown`, `ChevronLeft`) — the repo already uses lucide in feature components (`service-dialog.tsx`); `HugeiconsIcon` + `Upload04Icon` for the upload button (mirrors `branding-form.tsx`).
- Commands: `npm run verify` (lint + typecheck + unit), `npx vitest run <path>`, `npm run test:integration` (needs `supabase start` + `npm run db:migrate`), `npx vitest run --config vitest.integration.config.ts <path>`. After the last task: `graphify update .` (repo rule).
- Never gate production behaviour on `NODE_ENV` (repo lesson) — nothing in this plan does.

## File structure

```
src/db/schema/booking-pages.ts                 Drizzle table (Task 4)
src/db/migrations/0047_*.sql, 0048_booking_pages_security.sql
src/features/booking-page/
  images.ts (+ .test.ts)                       pure: limits, path builder/regex, imagePathsIn, orphanPaths, pageImageUrl   (Task 1)
  schema.ts (+ .test.ts)                       zod sections + document, parsePageDocument, error copy                      (Task 2)
  defaults.ts                                  SECTION_META, ADDABLE_TYPES, newSection, DEFAULT_PAGE                        (Task 2)
  doc-ops.ts (+ .test.ts)                      pure ops: empty rule, insert/remove/move/replace/hide, summary, deepEqual, issuesBySection (Task 3)
  rpc.integration.test.ts                      RPCs + table access                                                          (Task 4)
  queries.ts                                   getPublishedPage (admin, cached), getPageDraftState, getPageSectionsEntitlement (Tasks 5, 11)
  actions.ts                                   save/publish/discard, uploadPageImage, orphan cleanup                        (Tasks 5, 10, 11)
  initial-service.ts (+ .test.ts)              ?service= resolution                                                         (Task 6)
  metadata.ts (+ .test.ts)                     generateMetadata input                                                       (Task 6)
  gating.ts (+ .test.ts)                       pageSections entitlement rule                                                (Task 11)
  templates.ts (+ .test.ts)                    TEMPLATES, applyTemplate, templatePreview                                    (Task 16)
  render/context.ts                            RenderContext (serializable)                                                 (Task 7)
  render/page-state.tsx                        services → widget hand-off                                                   (Task 7)
  render/selection.tsx                         studio selection context                                                     (Task 7)
  render/ghost.tsx, render/section-frame.tsx   preview-only chrome                                                          (Task 7)
  render/sections/{header,hero,about,gallery,testimonials,faq,links,location}.tsx                                           (Task 7)
  render/sections/{services,staff,booking}.tsx                                                                              (Task 8)
  render/page-renderer.tsx                     PageRenderer, pageContainerClass                                             (Task 8)
  studio/use-page-draft.ts                     draft state, autosave, publish, discard                                      (Task 12)
  studio/fields.tsx, studio/image-field.tsx, studio/forms/types.ts, studio/forms/<type>.tsx, studio/section-inspector.tsx  (Task 13)
  studio/{studio-tabs,publish-bar,confirm-dialog,section-row,add-section-popover,layout-toggle,sections-panel}.tsx          (Task 14)
  studio/{settings-tab,booking-page-builder}.tsx                                                                            (Task 15)
  studio/template-picker.tsx                                                                                                (Task 16)
src/features/scheduling/components/booking-widget.tsx   + requestedService prop                                             (Task 6)
src/app/book/[handle]/page.tsx, src/app/book/[handle]/[staffSlug]/page.tsx   renderer + generateMetadata                    (Task 9)
src/lib/billing/plans.ts                       PlanLimits.pageSections                                                      (Task 11)
src/app/(dashboard)/booking-page/page.tsx      feeds the builder                                                            (Task 15)
src/features/orgs/components/booking-page-studio.tsx   DELETED (absorbed by studio/booking-page-builder.tsx)               (Task 15)
```

---

### Task 1: Image helpers (pure)

**Files:**
- Create: `src/features/booking-page/images.ts`
- Test: `src/features/booking-page/images.test.ts`

**Interfaces:**
- Produces: `PAGE_IMAGE_MAX_BYTES`, `PAGE_IMAGE_ACCEPT`, `isAllowedPageImageType(mime)`, `PAGE_IMAGE_PATH_RE`, `pageImagePathFor(orgId, checksum, mime): string | null`, `pageImagePrefix(orgId)`, `pageImageUrl(supabaseUrl, path)`, `sectionImagePaths(section)`, `imagePathsIn(doc)`, `orphanPaths(listed, referenced)`.
- Consumes: `Section`/`PageDocument` types from Task 2 (type-only import; Task 2 imports values from this file — that is fine).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/booking-page/images.test.ts
import { describe, it, expect } from "vitest";
import {
  PAGE_IMAGE_PATH_RE, pageImagePathFor, pageImagePrefix, pageImageUrl, imagePathsIn, orphanPaths,
  isAllowedPageImageType,
} from "./images";

const ORG = "123e4567-e89b-12d3-a456-426614174000";
const SHA = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("pageImagePathFor", () => {
  it("builds {orgId}/page/{sha:16}.{ext} for the three raster types", () => {
    expect(pageImagePathFor(ORG, SHA, "image/png")).toBe(`${ORG}/page/abcdef0123456789.png`);
    expect(pageImagePathFor(ORG, SHA, "image/jpeg")).toBe(`${ORG}/page/abcdef0123456789.jpg`);
    expect(pageImagePathFor(ORG, SHA, "image/webp")).toBe(`${ORG}/page/abcdef0123456789.webp`);
  });
  it("refuses anything else (SVG included)", () => {
    expect(pageImagePathFor(ORG, SHA, "image/svg+xml")).toBeNull();
    expect(isAllowedPageImageType("image/svg+xml")).toBe(false);
    expect(isAllowedPageImageType("image/webp")).toBe(true);
  });
  it("every built path matches PAGE_IMAGE_PATH_RE and the org prefix", () => {
    const p = pageImagePathFor(ORG, SHA, "image/png")!;
    expect(PAGE_IMAGE_PATH_RE.test(p)).toBe(true);
    expect(p.startsWith(pageImagePrefix(ORG))).toBe(true);
  });
  it("rejects traversal, logo paths and foreign shapes", () => {
    for (const bad of [`${ORG}/logo-${SHA}.png`, `../${ORG}/page/abcdef0123456789.png`, `${ORG}/page/x.png`, `${ORG}/page/abcdef0123456789.svg`]) {
      expect(PAGE_IMAGE_PATH_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("pageImageUrl", () => {
  it("mirrors storage.getPublicUrl for the branding bucket", () => {
    expect(pageImageUrl("http://127.0.0.1:54351", `${ORG}/page/abcdef0123456789.png`)).toBe(
      `http://127.0.0.1:54351/storage/v1/object/public/branding/${ORG}/page/abcdef0123456789.png`,
    );
    expect(pageImageUrl("https://x.supabase.co/", "a/page/b.png")).toBe("https://x.supabase.co/storage/v1/object/public/branding/a/page/b.png");
  });
});

describe("imagePathsIn / orphanPaths", () => {
  const doc = {
    sections: [
      { id: "hero0001", type: "hero" as const, hidden: false, headline: "", subheadline: "", align: "left" as const, imagePath: "o/page/a.png" },
      { id: "about001", type: "about" as const, hidden: false, title: "", body: "", photoPath: "o/page/b.png" },
      { id: "gal00001", type: "gallery" as const, hidden: false, columns: 3 as const, images: [{ path: "o/page/c.png", alt: "" }, { path: "o/page/a.png", alt: "" }] },
      { id: "booking1", type: "booking" as const, hidden: false as const, title: "" },
    ],
  };
  it("collects hero, about and gallery paths in order (duplicates kept)", () => {
    expect(imagePathsIn(doc)).toEqual(["o/page/a.png", "o/page/b.png", "o/page/c.png", "o/page/a.png"]);
  });
  it("orphanPaths = listed minus referenced", () => {
    expect(orphanPaths(["o/page/a.png", "o/page/z.png", "o/page/c.png"], imagePathsIn(doc))).toEqual(["o/page/z.png"]);
    expect(orphanPaths([], ["o/page/a.png"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/booking-page/images.test.ts`
Expected: FAIL — cannot resolve `./images`.

- [ ] **Step 3: Implement**

```ts
// src/features/booking-page/images.ts
// Pure helpers for booking-page images — safe to import from client code
// (the studio's upload control and the preview resolve URLs with these).
// Storage I/O (server-only) lives in actions.ts via lib/storage/branding.
// Same split as lib/storage/logo.ts vs branding.ts.
import type { PageDocument, Section } from "./schema";

export const PAGE_IMAGE_MAX_BYTES = 5 * 1_048_576;
export const PAGE_IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const PAGE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export function isAllowedPageImageType(mime: string): boolean {
  return Object.hasOwn(PAGE_IMAGE_MIME_EXTENSIONS, mime);
}

/** `{orgId}/page/{sha256:16}.{ext}` — the `{orgId}/` prefix is the same
    discipline logoPathFor uses, so one bucket rule covers both. */
export const PAGE_IMAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/page\/[0-9a-f]{16}\.(?:jpg|png|webp)$/;

export function pageImagePrefix(orgId: string): string {
  return `${orgId}/page/`;
}

export function pageImagePathFor(orgId: string, checksum: string, mime: string): string | null {
  const ext = PAGE_IMAGE_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${pageImagePrefix(orgId)}${checksum.slice(0, 16)}.${ext}`;
}

/** Public URL of an object in the branding bucket. Mirrors
    storage.getPublicUrl so the client-side preview needs no Supabase client. */
export function pageImageUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/branding/${path}`;
}

export function sectionImagePaths(section: Section): string[] {
  switch (section.type) {
    case "hero":
      return section.imagePath ? [section.imagePath] : [];
    case "about":
      return section.photoPath ? [section.photoPath] : [];
    case "gallery":
      return section.images.map((i) => i.path);
    default:
      return [];
  }
}

export function imagePathsIn(doc: Pick<PageDocument, "sections">): string[] {
  return doc.sections.flatMap(sectionImagePaths);
}

/** Objects under the org's page prefix that no document references any more. */
export function orphanPaths(listed: readonly string[], referenced: readonly string[]): string[] {
  const keep = new Set(referenced);
  return listed.filter((p) => !keep.has(p));
}
```

- [ ] **Step 4: Run the test** — `npx vitest run src/features/booking-page/images.test.ts`. Expected: the `imagePathsIn` block fails to type-check only until Task 2 exists; vitest itself (esbuild, no type-check) runs green: all tests PASS. (`npm run typecheck` is run at the end of Task 2.)

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/images.ts src/features/booking-page/images.test.ts
git commit -m "feat(booking-page): pure image path/url helpers"
```

---

### Task 2: Document schema + defaults

**Files:**
- Create: `src/features/booking-page/schema.ts`, `src/features/booking-page/defaults.ts`
- Test: `src/features/booking-page/schema.test.ts`

**Interfaces:**
- Produces: `PAGE_LIMITS`, `SECTION_TYPES`, `SectionType`, `SINGLE_INSTANCE_TYPES`, `LINK_ICONS`, `LinkIcon`, `allowedLinkUrl`, per-type schemas, `sectionSchema`, `Section`, `SectionOf<T>`, `pageDocumentSchema`, `PageDocument`, `parsePageDocument(raw, orgId)`, error copy `PAGE_TOO_LARGE_ERROR`, `IMAGE_REJECTED_ERROR`, `PAGE_GATED_ERROR`; from defaults: `SECTION_META`, `ADDABLE_TYPES`, `newSectionId()`, `newSection(type, id?)`, `DEFAULT_PAGE`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/booking-page/schema.test.ts
import { describe, it, expect } from "vitest";
import { pageDocumentSchema, parsePageDocument, allowedLinkUrl, PAGE_LIMITS, type PageDocument } from "./schema";
import { DEFAULT_PAGE, newSection, newSectionId, ADDABLE_TYPES, SECTION_META } from "./defaults";

const ORG = "123e4567-e89b-12d3-a456-426614174000";
const IMG = `${ORG}/page/abcdef0123456789.png`;
const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;

describe("pageDocumentSchema", () => {
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
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/booking-page/schema.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `schema.ts`**

```ts
// src/features/booking-page/schema.ts
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

const HTTPS_RE = /^https:\/\/\S+$/;
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
```

- [ ] **Step 4: Implement `defaults.ts`**

```ts
// src/features/booking-page/defaults.ts
import type { PageDocument, Section, SectionType } from "./schema";

export const SECTION_META: Record<SectionType, { label: string; description: string }> = {
  header: { label: "Header", description: "Your logo, name and an optional tagline." },
  hero: { label: "Cover", description: "A big headline with an optional cover image." },
  about: { label: "About", description: "Who you are, with a photo." },
  services: { label: "Services", description: "What you offer, from your service list." },
  staff: { label: "Team", description: "Your bookable team members." },
  gallery: { label: "Gallery", description: "A grid of photos." },
  testimonials: { label: "Testimonials", description: "Quotes from happy clients." },
  faq: { label: "FAQ", description: "Common questions, answered." },
  links: { label: "Links", description: "Instagram, WhatsApp, your website…" },
  location: { label: "Location", description: "Your address and a maps link." },
  booking: { label: "Booking", description: "The booking widget. Always on the page." },
};

/** What the palette offers. `booking` is seeded and can't be removed;
    `header` is seeded too but may be re-added after deletion. */
export const ADDABLE_TYPES: readonly SectionType[] = [
  "header", "hero", "about", "services", "staff", "gallery", "testimonials", "faq", "links", "location",
];

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newSectionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function newSection(type: SectionType, id: string = newSectionId()): Section {
  const base = { id, hidden: false as const };
  switch (type) {
    case "header": return { ...base, type, tagline: "" };
    case "hero": return { ...base, type, headline: "", subheadline: "", align: "left" };
    case "about": return { ...base, type, title: "", body: "" };
    case "services": return { ...base, type, title: "Services", style: "list", showPrices: true, showDurations: true };
    case "staff": return { ...base, type, title: "Team" };
    case "gallery": return { ...base, type, images: [], columns: 3 };
    case "testimonials": return { ...base, type, items: [{ quote: "", author: "" }] };
    case "faq": return { ...base, type, items: [{ q: "", a: "" }] };
    case "links": return { ...base, type, items: [{ label: "", url: "", icon: "instagram" }] };
    case "location": return { ...base, type, address: "", mapsUrl: "" };
    case "booking": return { ...base, type, title: "" };
  }
}

/** Today's page: header + widget. Stable ids so two fresh orgs produce equal documents. */
export const DEFAULT_PAGE: PageDocument = {
  version: 1,
  layout: "column",
  sections: [newSection("header", "header01"), newSection("booking", "booking1")],
};
```

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run src/features/booking-page/` then `npm run typecheck`. Expected: all PASS, no type errors (Task 1's type-only import now resolves).

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/schema.ts src/features/booking-page/defaults.ts src/features/booking-page/schema.test.ts
git commit -m "feat(booking-page): zod document schema, defaults and section catalogue"
```

---

### Task 3: Document operations (pure)

**Files:**
- Create: `src/features/booking-page/doc-ops.ts`
- Test: `src/features/booking-page/doc-ops.test.ts`

**Interfaces:**
- Consumes: `PageDocument`, `Section`, `SectionType`, `PAGE_LIMITS`, `SINGLE_INSTANCE_TYPES` (Task 2), `newSection`, `SECTION_META` (Task 2).
- Produces: `EmptyContext`, `isSectionEmpty`, `publicSections`, `emptyVisibleSections`, `canAddSection`, `insertSection`, `removeSection`, `moveSection`, `replaceSection`, `setSectionHidden`, `sectionSummary`, `deepEqual`, `hasUnpublishedChanges`, `IssueMap`, `issuesBySection`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/booking-page/doc-ops.test.ts
import { describe, it, expect } from "vitest";
import {
  isSectionEmpty, publicSections, emptyVisibleSections, canAddSection, insertSection, removeSection, moveSection,
  replaceSection, setSectionHidden, sectionSummary, deepEqual, hasUnpublishedChanges, issuesBySection,
} from "./doc-ops";
import { DEFAULT_PAGE, newSection } from "./defaults";
import { pageDocumentSchema } from "./schema";

const ctx = { serviceCount: 2, staffCount: 1 };
const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;

describe("isSectionEmpty", () => {
  it("header and booking are never empty", () => {
    expect(isSectionEmpty(header, ctx)).toBe(false);
    expect(isSectionEmpty(booking, ctx)).toBe(false);
  });
  it("text sections are empty until something is written or an image set", () => {
    const hero = newSection("hero");
    expect(isSectionEmpty(hero, ctx)).toBe(true);
    expect(isSectionEmpty({ ...hero, headline: "  " }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...hero, headline: "Hi" }, ctx)).toBe(false);
    expect(isSectionEmpty({ ...hero, imagePath: "o/page/a.png" }, ctx)).toBe(false);
    const faq = newSection("faq");
    expect(isSectionEmpty(faq, ctx)).toBe(true);
    expect(isSectionEmpty({ ...faq, items: [{ q: "Q", a: "" }] }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...faq, items: [{ q: "Q", a: "A" }] }, ctx)).toBe(false);
    const links = newSection("links");
    expect(isSectionEmpty({ ...links, items: [{ label: "IG", url: "", icon: "instagram" }] }, ctx)).toBe(true);
    expect(isSectionEmpty({ ...links, items: [{ label: "IG", url: "https://x", icon: "instagram" }] }, ctx)).toBe(false);
  });
  it("live sections depend on the org", () => {
    expect(isSectionEmpty(newSection("services"), { serviceCount: 0, staffCount: 1 })).toBe(true);
    expect(isSectionEmpty(newSection("staff"), { serviceCount: 1, staffCount: 1 })).toBe(true);
    expect(isSectionEmpty(newSection("staff"), { serviceCount: 1, staffCount: 2 })).toBe(false);
  });
});

describe("publicSections / emptyVisibleSections", () => {
  const hero = { ...newSection("hero"), headline: "Hi" };
  const emptyFaq = newSection("faq");
  const hiddenAbout = { ...newSection("about"), title: "Me", hidden: true };
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
    expect(canAddSection(DEFAULT_PAGE, "header").ok).toBe(false);
    expect(canAddSection(DEFAULT_PAGE, "hero").ok).toBe(true);
    const full = { ...DEFAULT_PAGE, sections: [header, ...Array.from({ length: 18 }, () => newSection("hero")), booking] };
    expect(canAddSection(full, "hero").ok).toBe(false);
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
  const hero = newSection("hero", "hero0001");
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
    const next = replaceSection(doc, { ...hero, headline: "New" });
    expect(next.sections[1]).toEqual({ ...hero, headline: "New" });
    expect(setSectionHidden(doc, hero.id, true).sections[1]!.hidden).toBe(true);
    expect(setSectionHidden(doc, booking.id, true)).toBe(doc);
  });
});

describe("sectionSummary", () => {
  it("describes each section in one line", () => {
    expect(sectionSummary(header)).toBe("Logo and name");
    expect(sectionSummary({ ...header, tagline: "Hair & colour" })).toBe("Hair & colour");
    expect(sectionSummary({ ...newSection("gallery"), images: [{ path: "p", alt: "" }] })).toBe("1 image");
    expect(sectionSummary(newSection("faq"))).toBe("0 questions");
    expect(sectionSummary({ ...newSection("location"), address: "Main St 1\nWarsaw" })).toBe("Main St 1");
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
    const links = { ...newSection("links", "links001"), items: [{ label: "x", url: "http://x", icon: "instagram" as const }] };
    const doc = { ...DEFAULT_PAGE, sections: [header, links, booking] };
    const res = pageDocumentSchema.safeParse(doc);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(issuesBySection(doc, res.error.issues)).toEqual({
      links001: { "items.0.url": "Use an https:// link (tel: for phone, mailto: for email)." },
    });
  });
  it("keys a page-level issue under ''", () => {
    const doc = { ...DEFAULT_PAGE, sections: [header, { ...booking, id: "booking2" }, booking] };
    const res = pageDocumentSchema.safeParse(doc);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(issuesBySection(doc, res.error.issues)[""]?.["sections"]).toContain("exactly one booking");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/booking-page/doc-ops.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/features/booking-page/doc-ops.ts
// Pure operations on a page document. Everything the studio and the public
// renderer decide lives here so it can be unit-tested without React
// (bookable.ts doctrine).
import { PAGE_LIMITS, SINGLE_INSTANCE_TYPES, type PageDocument, type Section, type SectionType } from "./schema";
import { newSection, SECTION_META } from "./defaults";

export type EmptyContext = { serviceCount: number; staffCount: number };

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
```

- [ ] **Step 4: Run tests** — `npx vitest run src/features/booking-page/doc-ops.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/doc-ops.ts src/features/booking-page/doc-ops.test.ts
git commit -m "feat(booking-page): pure document operations"
```

---

### Task 4: `booking_pages` table, security migration, RPCs

**Files:**
- Create: `src/db/schema/booking-pages.ts`, `src/db/migrations/0047_<generated>.sql`, `src/db/migrations/0048_booking_pages_security.sql`
- Modify: `src/db/schema/index.ts`
- Test: `src/features/booking-page/rpc.integration.test.ts`

**Interfaces:**
- Produces RPCs: `save_booking_page_draft(p_org_id uuid, p_doc jsonb)` (sentinels `'not found'`, `'too large'`), `publish_booking_page(p_org_id uuid)`, `discard_booking_page_draft(p_org_id uuid, p_fallback jsonb)` (no-op when the org has no row). Table `booking_pages(org_id pk, draft jsonb not null, published jsonb, published_at, updated_at)`; members may `select`, nobody but `service_role` writes directly.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/features/booking-page/rpc.integration.test.ts
/**
 * Booking page builder RPCs + table access: save_booking_page_draft,
 * publish_booking_page, discard_booking_page_draft, and the RLS/grants on
 * booking_pages. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PAGE } from "./defaults";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let strangerOrgId: string;

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const withHero = {
  ...DEFAULT_PAGE,
  sections: [header, { id: "hero0001", type: "hero", hidden: false, headline: "Hi", subheadline: "", align: "left" }, booking],
};

beforeAll(async () => {
  owner = await signedInUser("bp_owner");
  stranger = await signedInUser("bp_stranger");
  const { data: org, error } = await owner.rpc("create_org", { p_name: "PageCo" });
  if (error) throw error;
  orgId = (org as { id: string }).id;
  const { data: org2, error: e2 } = await stranger.rpc("create_org", { p_name: "StrangerPageCo" });
  if (e2) throw e2;
  strangerOrgId = (org2 as { id: string }).id;
});

describe("save_booking_page_draft", () => {
  it("member upserts the draft; published stays null", async () => {
    const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published").eq("org_id", orgId).single();
    expect(data!.draft).toEqual(DEFAULT_PAGE);
    expect(data!.published).toBeNull();
    const { error: e2 } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: withHero });
    expect(e2).toBeNull();
    const { data: d2 } = await admin.from("booking_pages").select("draft").eq("org_id", orgId).single();
    expect(d2!.draft).toEqual(withHero);
  });
  it("rejects a non-member, a wrong version, no booking section, two booking sections, a non-object", async () => {
    expect((await stranger.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE })).error).not.toBeNull();
    for (const bad of [
      { ...DEFAULT_PAGE, version: 2 },
      { ...DEFAULT_PAGE, sections: [header] },
      { ...DEFAULT_PAGE, sections: [header, booking, { ...booking, id: "booking2" }] },
      [],
    ]) {
      const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: bad });
      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  });
  it("rejects a document over 64 KB with the size sentinel", async () => {
    const big = { ...DEFAULT_PAGE, sections: [{ ...header, tagline: "x".repeat(70_000) }, booking] };
    const { error } = await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: big });
    expect(error?.message).toBe("too large");
  });
});

describe("publish / discard", () => {
  it("publish copies the draft and stamps published_at", async () => {
    const { error } = await owner.rpc("publish_booking_page", { p_org_id: orgId });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published, published_at").eq("org_id", orgId).single();
    expect(data!.published).toEqual(data!.draft);
    expect(data!.published_at).not.toBeNull();
  });
  it("discard reverts the draft to the published document", async () => {
    await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: DEFAULT_PAGE });
    const { error } = await owner.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft").eq("org_id", orgId).single();
    expect(data!.draft).toEqual(withHero);
  });
  it("discard falls back to p_fallback when never published, and is a no-op without a row", async () => {
    expect((await stranger.rpc("discard_booking_page_draft", { p_org_id: strangerOrgId, p_fallback: DEFAULT_PAGE })).error).toBeNull();
    await stranger.rpc("save_booking_page_draft", { p_org_id: strangerOrgId, p_doc: withHero });
    const { error } = await stranger.rpc("discard_booking_page_draft", { p_org_id: strangerOrgId, p_fallback: DEFAULT_PAGE });
    expect(error).toBeNull();
    const { data } = await admin.from("booking_pages").select("draft, published").eq("org_id", strangerOrgId).single();
    expect(data!.published).toBeNull();
    expect(data!.draft).toEqual(DEFAULT_PAGE);
  });
  it("publish and discard reject a non-member; publish rejects an org with no row", async () => {
    expect((await stranger.rpc("publish_booking_page", { p_org_id: orgId })).error).not.toBeNull();
    expect((await stranger.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE })).error).not.toBeNull();
    const third = await signedInUser("bp_third");
    const { data: org3 } = await third.rpc("create_org", { p_name: "NoRowCo" });
    expect((await third.rpc("publish_booking_page", { p_org_id: (org3 as { id: string }).id })).error).not.toBeNull();
  });
});

describe("table access", () => {
  it("member selects own row; stranger sees nothing; anon is refused; member cannot write", async () => {
    const mine = await owner.from("booking_pages").select("org_id").eq("org_id", orgId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    expect((await stranger.from("booking_pages").select("org_id").eq("org_id", orgId)).data ?? []).toHaveLength(0);
    expect((await anon.from("booking_pages").select("org_id")).error).not.toBeNull();
    expect((await owner.from("booking_pages").update({ published: DEFAULT_PAGE }).eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("booking_pages").delete().eq("org_id", orgId)).error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `supabase start` (if not running), then `npx vitest run --config vitest.integration.config.ts src/features/booking-page/rpc.integration.test.ts`. Expected: FAIL (function `save_booking_page_draft` does not exist).

- [ ] **Step 3: Drizzle table**

```ts
// src/db/schema/booking-pages.ts
import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One booking page per org (spec 2026-08-23-booking-page-builder). `draft`
// is what the studio edits, `published` what /book/[handle] renders (null =
// never published → the page renders the default composition). Both are
// validated documents (features/booking-page/schema.ts); the renderer still
// safeParses them. Written ONLY via the save/publish/discard definer RPCs in
// 0048 — members may select their own row, nothing more.
export const bookingPages = pgTable("booking_pages", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  draft: jsonb("draft").notNull(),
  published: jsonb("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Add to `src/db/schema/index.ts` (keep the header comment's list current):

```ts
export * from "./booking-pages";
```

- [ ] **Step 4: Generate 0047 and inspect it**

Run: `npx drizzle-kit generate`
Expected: `src/db/migrations/0047_<words>.sql` containing exactly one `CREATE TABLE "booking_pages"` (five columns, `org_id` PK) and one `ALTER TABLE … booking_pages_org_id_orgs_id_fk … ON DELETE cascade`; `meta/_journal.json` gains idx 47. Nothing else — if there are unrelated diffs, stop and investigate.

- [ ] **Step 5: Write 0048**

Run: `npx drizzle-kit generate --custom --name=booking_pages_security` and fill `src/db/migrations/0048_booking_pages_security.sql`:

```sql
-- 0048 (Booking page builder): RLS, grants and the three definer RPCs for
-- booking_pages (spec 2026-08-23-booking-page-builder). Idempotent.

-- ---------- RLS: members read their own org's row; nobody but service_role writes directly.
alter table public.booking_pages enable row level security;
drop policy if exists "booking_pages_select_member" on public.booking_pages;
create policy "booking_pages_select_member" on public.booking_pages
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies on purpose: writes go through the RPCs below.

-- ---------- Grants (explicit; anon gets nothing — the public page reads via service_role)
revoke all on table public.booking_pages from public, anon, authenticated, service_role;
grant select on table public.booking_pages to authenticated;
grant select, insert, update, delete on table public.booking_pages to service_role;

-- ---------- Save draft. Cheap structural checks only: size cap, version,
-- exactly one booking section. Full shape validation is zod in the server
-- action, and the public renderer safeParses regardless.
create or replace function public.save_booking_page_draft(
  p_org_id uuid,
  p_doc jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not found'; end if;
  if pg_column_size(p_doc) > 65536 then raise exception 'too large'; end if;
  if p_doc->>'version' is distinct from '1' then raise exception 'not found'; end if;
  if jsonb_typeof(p_doc->'sections') <> 'array' then raise exception 'not found'; end if;
  if (select count(*) from jsonb_array_elements(p_doc->'sections') s where s->>'type' = 'booking') <> 1 then
    raise exception 'not found';
  end if;

  insert into public.booking_pages (org_id, draft, updated_at)
    values (p_org_id, p_doc, now())
    on conflict (org_id) do update set draft = excluded.draft, updated_at = now();
end;
$$;

revoke all on function public.save_booking_page_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_booking_page_draft(uuid, jsonb) to authenticated;

-- ---------- Publish: the draft becomes the live page. The action always
-- saves first, so a missing row here is a genuine error.
create or replace function public.publish_booking_page(
  p_org_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  update public.booking_pages
    set published = draft, published_at = now(), updated_at = now()
    where org_id = p_org_id;
  if not found then raise exception 'not found'; end if;
end;
$$;

revoke all on function public.publish_booking_page(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_booking_page(uuid) to authenticated;

-- ---------- Discard: draft goes back to the published page, or to the
-- caller-supplied default composition when never published. No row = nothing
-- to discard (not an error: the studio may never have autosaved).
create or replace function public.discard_booking_page_draft(
  p_org_id uuid,
  p_fallback jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_fallback is null or jsonb_typeof(p_fallback) <> 'object' then raise exception 'not found'; end if;
  update public.booking_pages
    set draft = coalesce(published, p_fallback), updated_at = now()
    where org_id = p_org_id;
end;
$$;

revoke all on function public.discard_booking_page_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_booking_page_draft(uuid, jsonb) to authenticated;

-- PostgREST caches the schema; the new table/RPCs must be visible immediately.
notify pgrst, 'reload schema';
```

- [ ] **Step 6: Apply locally and verify drift gate**

Run: `npm run db:migrate` then `npm run db:generate`
Expected: 0047 and 0048 applied; `db:generate` reports "No schema changes".

- [ ] **Step 7: Run the integration test** — `npx vitest run --config vitest.integration.config.ts src/features/booking-page/rpc.integration.test.ts`. Expected: PASS (all four describe blocks).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/booking-pages.ts src/db/schema/index.ts src/db/migrations src/features/booking-page/rpc.integration.test.ts
git commit -m "feat(db): booking_pages table, RLS/grants and save/publish/discard RPCs (0047, 0048)"
```

---

### Task 5: Queries and draft/publish/discard actions

**Files:**
- Create: `src/features/booking-page/queries.ts`, `src/features/booking-page/actions.ts`
- Test: extend `src/features/booking-page/rpc.integration.test.ts`

**Interfaces:**
- Produces: `getPublishedPage(orgId): Promise<PageDocument>` (admin client, `cache`d, never throws), `getPageDraftState(orgId): Promise<PageDraftState>` (session client), `saveBookingPageDraft(input)`, `publishBookingPage(input)`, `discardBookingPageDraft()` — all `Promise<ActionState>`.
- Consumes: RPCs (Task 4), `pageDocumentSchema`, `DEFAULT_PAGE`, `PAGE_TOO_LARGE_ERROR`, `imagePathsIn`, `pageImagePrefix`.

- [ ] **Step 1: Extend the integration test** — append to `rpc.integration.test.ts`:

```ts
describe("getPublishedPage", () => {
  // Dynamic import: queries.ts reaches @/env through the admin client, which
  // parses process.env at module load — after loadEnvFile() above.
  it("returns the published document, and DEFAULT_PAGE when never published or unparseable", async () => {
    const { getPublishedPage } = await import("./queries");
    await owner.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: withHero });
    await owner.rpc("publish_booking_page", { p_org_id: orgId });
    expect(await getPublishedPage(orgId)).toEqual(withHero);
    expect(await getPublishedPage(strangerOrgId)).toEqual(DEFAULT_PAGE);
    // Junk that passes the SQL checks but not zod: the renderer must never trust it.
    await admin.from("booking_pages").update({ published: { ...withHero, layout: "diagonal" } }).eq("org_id", orgId);
    expect(await getPublishedPage(orgId)).toEqual(DEFAULT_PAGE);
    await owner.rpc("publish_booking_page", { p_org_id: orgId });
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run --config vitest.integration.config.ts src/features/booking-page/rpc.integration.test.ts -t getPublishedPage`. Expected: FAIL (no `./queries`).

- [ ] **Step 3: Implement `queries.ts`**

```ts
// src/features/booking-page/queries.ts
import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PAGE } from "./defaults";
import { parsePageDocument, type PageDocument } from "./schema";

/** The published document for a public page, or DEFAULT_PAGE when there is
    none / it fails to parse (logged). Admin client: the public surface stays
    off the anon grant surface (getBookingOrg precedent). Memoised per
    request — the page and generateMetadata both read it. */
export const getPublishedPage = cache(async (orgId: string): Promise<PageDocument> => {
  const admin = createAdminClient();
  const { data, error } = await admin.from("booking_pages").select("published").eq("org_id", orgId).maybeSingle();
  if (error) {
    console.error("[booking-page] published read failed:", error.message);
    return DEFAULT_PAGE;
  }
  if (!data?.published) return DEFAULT_PAGE;
  const doc = parsePageDocument(data.published, orgId);
  if (!doc) {
    console.error(`[booking-page] published document for org ${orgId} failed to parse — rendering the default page`);
    return DEFAULT_PAGE;
  }
  return doc;
});

export type PageDraftState = { draft: PageDocument; published: PageDocument | null; publishedAt: string | null };

/** RLS-scoped read for the studio. An unparseable stored draft falls back to
    the published page, then to the default — the same doctrine as above. */
export async function getPageDraftState(orgId: string): Promise<PageDraftState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pages")
    .select("draft, published, published_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { draft: DEFAULT_PAGE, published: null, publishedAt: null };
  const published = data.published ? parsePageDocument(data.published, orgId) : null;
  return {
    draft: parsePageDocument(data.draft, orgId) ?? published ?? DEFAULT_PAGE,
    published,
    publishedAt: data.published_at,
  };
}
```

- [ ] **Step 4: Implement `actions.ts`**

```ts
// src/features/booking-page/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
import { pageDocumentSchema, PAGE_TOO_LARGE_ERROR, type PageDocument } from "./schema";
import { DEFAULT_PAGE } from "./defaults";
import { imagePathsIn, pageImagePrefix } from "./images";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[booking-page] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

/** Full zod validation plus the org-prefix rule for every image path. */
function validateDocument(input: unknown, orgId: string): PageDocument | null {
  const parsed = pageDocumentSchema.safeParse(input);
  if (!parsed.success) return null;
  const prefix = pageImagePrefix(orgId);
  if (!imagePathsIn(parsed.data).every((p) => p.startsWith(prefix))) return null;
  return parsed.data;
}

async function saveDraft(orgId: string, doc: PageDocument): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: doc });
  if (error) {
    if (isRpcSentinel(error, "too large")) return { ok: false, error: PAGE_TOO_LARGE_ERROR };
    return fail("saveDraft", error);
  }
  return { ok: true };
}

export async function saveBookingPageDraft(input: unknown): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = validateDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  return saveDraft(orgId, doc);
}

/** Saves, then publishes — never depends on a pending autosave or an existing row. */
export async function publishBookingPage(input: unknown): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = validateDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  const saved = await saveDraft(orgId, doc);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_booking_page", { p_org_id: orgId });
  if (error) return fail("publishBookingPage", error);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function discardBookingPageDraft(): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE });
  if (error) return fail("discardBookingPageDraft", error);
  revalidatePath("/booking-page");
  return { ok: true };
}
```

- [ ] **Step 5: Run integration test + verify** — `npx vitest run --config vitest.integration.config.ts src/features/booking-page/rpc.integration.test.ts` (PASS) and `npm run verify` (PASS).

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/queries.ts src/features/booking-page/actions.ts src/features/booking-page/rpc.integration.test.ts
git commit -m "feat(booking-page): published/draft queries and save/publish/discard actions"
```

---

### Task 6: `?service=` resolution, metadata, widget `requestedService`

**Files:**
- Create: `src/features/booking-page/initial-service.ts`, `src/features/booking-page/metadata.ts`
- Modify: `src/features/scheduling/components/booking-widget.tsx:19-40` (props) and `:54-58` (state init)
- Test: `src/features/booking-page/initial-service.test.ts`, `src/features/booking-page/metadata.test.ts`

**Interfaces:**
- Produces: `resolveInitialService(services, param): string | null`; `pageDescription(doc, fallback)`, `heroImagePath(doc)`, `pageMetadata(doc, org, supabaseUrl): Metadata`; `BookingWidget` prop `requestedService?: { id: string; key: number } | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/booking-page/initial-service.test.ts
import { describe, it, expect } from "vitest";
import { resolveInitialService } from "./initial-service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const services = [{ id: A }, { id: B }];

describe("resolveInitialService", () => {
  it("returns the id when it names a listed service", () => {
    expect(resolveInitialService(services, A)).toBe(A);
  });
  it("ignores unknown ids, non-uuids, arrays and absence", () => {
    expect(resolveInitialService(services, "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(resolveInitialService(services, "preview-service")).toBeNull();
    expect(resolveInitialService(services, [A])).toBeNull();
    expect(resolveInitialService(services, undefined)).toBeNull();
  });
});
```

```ts
// src/features/booking-page/metadata.test.ts
import { describe, it, expect } from "vitest";
import { pageDescription, heroImagePath, pageMetadata } from "./metadata";
import { DEFAULT_PAGE, newSection } from "./defaults";

const header = DEFAULT_PAGE.sections[0]!;
const booking = DEFAULT_PAGE.sections[1]!;
const IMG = "123e4567-e89b-12d3-a456-426614174000/page/abcdef0123456789.png";

describe("pageDescription", () => {
  it("prefers hero headline, then header tagline, then about's first line, then the fallback", () => {
    const hero = { ...newSection("hero"), headline: "Hair by Anna", imagePath: IMG };
    const tagline = { ...header, tagline: "Colour specialist" };
    const about = { ...newSection("about"), body: "I cut hair.\n\nSince 2010." };
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [tagline, hero, about, booking] }, "fb")).toBe("Hair by Anna");
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [tagline, about, booking] }, "fb")).toBe("Colour specialist");
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [header, about, booking] }, "fb")).toBe("I cut hair.");
    expect(pageDescription(DEFAULT_PAGE, "fb")).toBe("fb");
  });
  it("skips hidden sections", () => {
    const hero = { ...newSection("hero"), headline: "Hidden", hidden: true };
    expect(pageDescription({ ...DEFAULT_PAGE, sections: [header, hero, booking] }, "fb")).toBe("fb");
  });
});

describe("pageMetadata", () => {
  it("sets title, description and an OG image only when the hero has one", () => {
    const hero = { ...newSection("hero"), headline: "Hair by Anna", imagePath: IMG };
    const meta = pageMetadata({ ...DEFAULT_PAGE, sections: [header, hero, booking] }, { orgName: "Anna's" }, "http://127.0.0.1:54351");
    expect(meta.title).toBe("Anna's");
    expect(meta.description).toBe("Hair by Anna");
    expect(meta.openGraph?.images).toEqual([`http://127.0.0.1:54351/storage/v1/object/public/branding/${IMG}`]);
    const plain = pageMetadata(DEFAULT_PAGE, { orgName: "Anna's" }, "http://x");
    expect(plain.description).toBe("Book an appointment with Anna's.");
    expect(plain.openGraph).toBeUndefined();
    expect(heroImagePath(DEFAULT_PAGE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run src/features/booking-page/`. Expected: the two new files FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// src/features/booking-page/initial-service.ts
// `?service=` deep link (pairs with the embed's `?staff=`): a uuid naming one
// of the plan-limited services, else null. Pure — the page passes the result
// into PageStateProvider; unknown ids are simply ignored.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function resolveInitialService(
  services: ReadonlyArray<{ id: string }>,
  param: string | string[] | undefined,
): string | null {
  if (typeof param !== "string" || !UUID_RE.test(param)) return null;
  return services.some((s) => s.id === param) ? param : null;
}
```

```ts
// src/features/booking-page/metadata.ts
import type { Metadata } from "next";
import type { PageDocument } from "./schema";
import { pageImageUrl } from "./images";

/** Spec precedence: hero headline → header tagline → first line of about → fallback. Hidden sections never leak. */
export function pageDescription(doc: PageDocument, fallback: string): string {
  const visible = doc.sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  if (hero?.type === "hero" && hero.headline.trim()) return hero.headline.trim();
  const header = visible.find((s) => s.type === "header");
  if (header?.type === "header" && header.tagline.trim()) return header.tagline.trim();
  const about = visible.find((s) => s.type === "about");
  if (about?.type === "about" && about.body.trim()) return about.body.trim().split("\n")[0]?.trim() || fallback;
  return fallback;
}

export function heroImagePath(doc: PageDocument): string | null {
  const hero = doc.sections.find((s) => s.type === "hero" && !s.hidden && s.imagePath);
  return hero?.type === "hero" ? hero.imagePath ?? null : null;
}

export function pageMetadata(doc: PageDocument, org: { orgName: string }, supabaseUrl: string): Metadata {
  const image = heroImagePath(doc);
  return {
    title: org.orgName,
    description: pageDescription(doc, `Book an appointment with ${org.orgName}.`),
    ...(image ? { openGraph: { images: [pageImageUrl(supabaseUrl, image)] } } : {}),
  };
}
```

- [ ] **Step 4: Widget prop** — in `src/features/scheduling/components/booking-widget.tsx`, add the prop and apply it during render (the "adjust state when a prop changes" pattern; no effect, so no set-state-in-effect lint):

Props (add after `preview`):

```tsx
  requestedService = null,
}: {
  // …existing props…
  preview?: { slots: string[] };
  /** Booking-page hand-off (services section / `?service=`): each request
      carries a key so re-picking the same service after "change" still applies. */
  requestedService?: { id: string; key: number } | null;
}) {
```

Right after the `useState` block that ends with `const staffRegionRef = …` (line ~77), add:

```tsx
  // Apply a requested service once per request key, during render (React's
  // sanctioned "adjust state on prop change"). Mirrors the service-card click
  // handler below minus the focus move — the caller scrolls instead.
  const [appliedRequestKey, setAppliedRequestKey] = React.useState(0);
  if (requestedService && requestedService.key !== appliedRequestKey) {
    setAppliedRequestKey(requestedService.key);
    const requested = services.find((s) => s.id === requestedService.id);
    if (requested) {
      setService(requested);
      setStaffChoice(resolveStaff(requested));
      setOffering(null);
      setSlot(null);
    }
  }
```

- [ ] **Step 5: Run tests + verify** — `npx vitest run src/features/booking-page/` (PASS) and `npm run verify` (PASS — the widget change is type-checked and linted; every existing call site is unaffected because the prop is optional).

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/initial-service.ts src/features/booking-page/initial-service.test.ts src/features/booking-page/metadata.ts src/features/booking-page/metadata.test.ts src/features/scheduling/components/booking-widget.tsx
git commit -m "feat(booking-page): ?service= resolution, page metadata, widget requestedService prop"
```

---

### Task 7: Render context, page state, preview chrome, content sections

**Files:**
- Create: `src/features/booking-page/render/context.ts`, `render/page-state.tsx`, `render/selection.tsx`, `render/ghost.tsx`, `render/section-frame.tsx`, `render/sections/header.tsx`, `hero.tsx`, `about.tsx`, `gallery.tsx`, `testimonials.tsx`, `faq.tsx`, `links.tsx`, `location.tsx`

**Interfaces:**
- Produces: `RenderContext` (serializable — no functions; it crosses the server→client boundary), `PageStateProvider({ initialServiceId, children })` + `usePageState(): { requested, selectService }`, `SelectionProvider({ value, children })` + `useSelection(): { selectedId, select }`, `Ghost({ mode, label, kind? })`, `SectionFrame({ id, type, hidden, className, children })`, and one `<Type>Section({ section, ctx })` per content type.
- Consumes: `SectionOf<T>` (Task 2), `pageImageUrl` (Task 1), `SECTION_META` (Task 2), `BrandedHeader`, `cn`.

No unit tests (components). Verification is `npm run verify` + the manual checklist in Task 17.

- [ ] **Step 1: Context + state providers**

```ts
// src/features/booking-page/render/context.ts
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Everything a section may need — and nothing a client component can't
    receive from a server one (plain data only, no functions). */
export type RenderContext = {
  org: { orgId: string; orgName: string; handle: string; timeZone: string };
  branding: { accentColor: string | null; logoUrl: string | null };
  /** Parsed widget theme; the booking section nests its own WidgetTheme with it. */
  theme: WidgetThemeConfig;
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds?: Record<string, string[]>;
  offerings: PublicOffering[];
  lockedStaff: PublicStaff | null;
  /** NEXT_PUBLIC_SUPABASE_URL — image paths resolve with pageImageUrl. */
  supabaseUrl: string;
  mode: "public" | "preview";
  /** Preview only: canned slots so the widget never fetches. */
  previewSlots?: string[];
};
```

```tsx
// src/features/booking-page/render/page-state.tsx
"use client";

import * as React from "react";

type Request = { id: string; key: number } | null;
type PageState = { requested: Request; selectService: (id: string) => void };

const Ctx = React.createContext<PageState>({ requested: null, selectService: () => {} });

/* Services section → booking widget hand-off. The key makes every request
   distinct, so picking the same service twice (after "change") still lands. */
export function PageStateProvider({ initialServiceId, children }: { initialServiceId: string | null; children: React.ReactNode }) {
  const [requested, setRequested] = React.useState<Request>(initialServiceId ? { id: initialServiceId, key: 1 } : null);
  const selectService = React.useCallback((id: string) => setRequested((prev) => ({ id, key: (prev?.key ?? 0) + 1 })), []);
  const value = React.useMemo(() => ({ requested, selectService }), [requested, selectService]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageState(): PageState {
  return React.useContext(Ctx);
}
```

```tsx
// src/features/booking-page/render/selection.tsx
"use client";

import * as React from "react";

export type Selection = { selectedId: string | null; select: (id: string) => void };
const Ctx = React.createContext<Selection>({ selectedId: null, select: () => {} });

/* Studio only: which section the preview highlights and the inspector edits.
   Absent (public page, template thumbnails) the default no-op context applies. */
export function SelectionProvider({ value, children }: { value: Selection; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  return React.useContext(Ctx);
}
```

- [ ] **Step 2: Preview chrome**

```tsx
// src/features/booking-page/render/ghost.tsx
import { cn } from "@/lib/utils";

/* Placeholder for an empty field — preview only. The public page renders
   nothing for it (publicSections already dropped fully empty sections). */
export function Ghost({ mode, label, kind = "text" }: { mode: "public" | "preview"; label: string; kind?: "text" | "image" }) {
  if (mode !== "preview") return null;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[var(--widget-radius)] border border-dashed text-sm opacity-60",
        kind === "image" ? "aspect-[16/9] w-full" : "px-3 py-2",
      )}
    >
      {label}
    </div>
  );
}
```

```tsx
// src/features/booking-page/render/section-frame.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SECTION_META } from "../defaults";
import type { SectionType } from "../schema";
import { useSelection } from "./selection";

/* Preview wrapper: hover outline, click/Enter to select, accent outline +
   type chip when selected, dimmed when the section is hidden. Scrolls
   itself into view when selected from the list. */
export function SectionFrame({
  id, type, hidden, className, style, children,
}: {
  id: string; type: SectionType; hidden: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  const { selectedId, select } = useSelection();
  const selected = selectedId === id;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  return (
    <div
      ref={ref}
      data-section-id={id}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${SECTION_META[type].label} section`}
      aria-pressed={selected}
      onClick={() => select(id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          select(id);
        }
      }}
      style={style}
      className={cn(
        "relative cursor-pointer rounded-[var(--widget-radius)] outline-2 outline-offset-4 outline-transparent transition-[outline-color] focus-visible:outline-[var(--widget-accent)]",
        "hover:outline-[color-mix(in_oklab,var(--widget-accent)_50%,transparent)]",
        selected && "outline-[var(--widget-accent)]",
        hidden && "opacity-40",
        className,
      )}
    >
      {selected || hidden ? (
        <span
          className="absolute -top-3 left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ background: "var(--widget-accent)" }}
        >
          {SECTION_META[type].label}
          {hidden ? " · hidden" : ""}
        </span>
      ) : null}
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Content sections** (all under `src/features/booking-page/render/sections/`; plain `<img>` with the same eslint pragma `BrandedHeader` uses — Supabase public URLs, no `remotePatterns` needed)

```tsx
// header.tsx
import { BrandedHeader } from "@/components/branded-header";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";

export function HeaderSection({ section, ctx }: { section: SectionOf<"header">; ctx: RenderContext }) {
  // A staff page keeps today's "Booking with X" line; the tagline otherwise.
  const subtitle = ctx.lockedStaff ? `Booking with ${ctx.lockedStaff.name}` : section.tagline.trim() || undefined;
  return (
    <BrandedHeader orgName={ctx.org.orgName} accentColor={ctx.branding.accentColor} logoUrl={ctx.branding.logoUrl} subtitle={subtitle} />
  );
}
```

```tsx
// hero.tsx
/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function HeroSection({ section, ctx }: { section: SectionOf<"hero">; ctx: RenderContext }) {
  const src = section.imagePath ? pageImageUrl(ctx.supabaseUrl, section.imagePath) : null;
  const center = section.align === "center";
  return (
    <section className={cn("flex flex-col gap-5", center && "items-center text-center")}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="aspect-[16/9] w-full rounded-[var(--widget-radius)] object-cover" />
      ) : (
        <Ghost mode={ctx.mode} kind="image" label="Add a cover image" />
      )}
      <div className={cn("flex flex-col gap-2", center && "items-center")}>
        {section.headline.trim() ? (
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{section.headline}</h1>
        ) : (
          <Ghost mode={ctx.mode} label="Add a headline" />
        )}
        {section.subheadline.trim() ? (
          <p className="text-muted-foreground max-w-prose text-base text-pretty sm:text-lg">{section.subheadline}</p>
        ) : null}
      </div>
    </section>
  );
}
```

```tsx
// about.tsx
/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function AboutSection({ section, ctx }: { section: SectionOf<"about">; ctx: RenderContext }) {
  const src = section.photoPath ? pageImageUrl(ctx.supabaseUrl, section.photoPath) : null;
  const paragraphs = section.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:gap-6">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" className="size-24 shrink-0 rounded-full object-cover" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => (
            <p key={i} className="text-muted-foreground whitespace-pre-line leading-relaxed">{p}</p>
          ))
        ) : (
          <Ghost mode={ctx.mode} label="Write a few lines about yourself" />
        )}
      </div>
    </section>
  );
}
```

```tsx
// gallery.tsx
/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function GallerySection({ section, ctx }: { section: SectionOf<"gallery">; ctx: RenderContext }) {
  if (section.images.length === 0) return <Ghost mode={ctx.mode} kind="image" label="Add photos to the gallery" />;
  return (
    <section className={cn("grid gap-2", section.columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {section.images.map((img, i) => (
        <img
          key={`${img.path}-${i}`}
          src={pageImageUrl(ctx.supabaseUrl, img.path)}
          alt={img.alt}
          loading="lazy"
          decoding="async"
          className="aspect-square w-full rounded-[var(--widget-radius)] object-cover"
        />
      ))}
    </section>
  );
}
```

```tsx
// testimonials.tsx
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function TestimonialsSection({ section, ctx }: { section: SectionOf<"testimonials">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.quote.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a client quote" />;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {items.map((item, i) => (
        <figure key={i} className="flex flex-col gap-3 rounded-[var(--widget-radius)] border p-4">
          <blockquote className="text-pretty leading-relaxed">“{item.quote.trim()}”</blockquote>
          {item.author.trim() ? <figcaption className="text-muted-foreground text-sm">— {item.author.trim()}</figcaption> : null}
        </figure>
      ))}
    </section>
  );
}
```

```tsx
// faq.tsx
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function FaqSection({ section, ctx }: { section: SectionOf<"faq">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.q.trim() && i.a.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a question and its answer" />;
  return (
    <section className="flex flex-col divide-y rounded-[var(--widget-radius)] border">
      {items.map((item, i) => (
        <details key={i} className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="text-muted-foreground mt-2 whitespace-pre-line leading-relaxed">{item.a}</p>
        </details>
      ))}
    </section>
  );
}
```

```tsx
// links.tsx
import type { LinkIcon, SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

const ICON_LABEL: Record<LinkIcon, string> = {
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp",
  website: "Website", phone: "Phone", email: "Email", other: "Link",
};
const PILL = "wt-surface inline-flex h-9 items-center gap-2 rounded-[var(--widget-radius)] border px-3.5 text-sm font-medium";

export function LinksSection({ section, ctx }: { section: SectionOf<"links">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.label.trim() && i.url.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a link" />;
  return (
    <section className="flex flex-wrap gap-2">
      {items.map((item, i) =>
        ctx.mode === "preview" ? (
          <span key={i} className={PILL}>{item.label}</span>
        ) : (
          <a
            key={i}
            href={item.url}
            // tel:/mailto: open in place; only web links get a tab.
            {...(item.url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            aria-label={`${item.label} (${ICON_LABEL[item.icon]})`}
            className={PILL}
          >
            {item.label}
          </a>
        ),
      )}
    </section>
  );
}
```

```tsx
// location.tsx
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function LocationSection({ section, ctx }: { section: SectionOf<"location">; ctx: RenderContext }) {
  const address = section.address.trim();
  const maps = section.mapsUrl.trim();
  if (!address && !maps) return <Ghost mode={ctx.mode} label="Add your address" />;
  const link = "text-sm font-medium underline underline-offset-3";
  return (
    <section className="flex flex-col gap-2 rounded-[var(--widget-radius)] border p-4">
      <h2 className="text-sm font-semibold">Where to find us</h2>
      {address ? <address className="text-muted-foreground whitespace-pre-line not-italic leading-relaxed">{address}</address> : null}
      {maps ? (
        ctx.mode === "preview" ? (
          <span className={link}>Open in Maps ↗</span>
        ) : (
          <a href={maps} target="_blank" rel="noopener noreferrer" className={link}>Open in Maps ↗</a>
        )
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Verify** — `npm run verify`. Expected: PASS (unused-export warnings are not errors; the files are wired in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/render
git commit -m "feat(booking-page): render context, page state, preview chrome, content sections"
```

---

### Task 8: Live sections and the page renderer

**Files:**
- Create: `src/features/booking-page/render/sections/services.tsx`, `staff.tsx`, `booking.tsx`, `src/features/booking-page/render/page-renderer.tsx`

**Interfaces:**
- Produces: `PageRenderer({ doc, ctx, initialServiceId? })`, `pageContainerClass(layout)`.
- Consumes: `publicSections` (Task 3), `PageStateProvider`/`usePageState`, `SectionFrame`, all section components, `BookingWidget` with `requestedService` (Task 6), `WidgetTheme`, `initials` from `@/features/scheduling/staff-slug`.

- [ ] **Step 1: Live sections**

```tsx
// services.tsx
"use client";

import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";

export function ServicesSection({ section, ctx }: { section: SectionOf<"services">; ctx: RenderContext }) {
  const { selectService } = usePageState();
  if (ctx.services.length === 0) return <Ghost mode={ctx.mode} label="Add a service and it shows here" />;
  const pick = (id: string) => {
    selectService(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cards = section.style === "cards";
  return (
    <section className="flex flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : "flex flex-col divide-y rounded-[var(--widget-radius)] border")}>
        {ctx.services.map((s) => {
          const meta = [section.showDurations ? `${s.durationMin} min` : null, section.showPrices ? s.priceLabel : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => pick(s.id)}
                className={cn(
                  "wt-surface flex w-full flex-col items-start gap-1 text-left",
                  cards ? "h-full rounded-[var(--widget-radius)] border p-4" : "px-4 py-3",
                )}
              >
                <span className="font-medium">{s.name}</span>
                {s.description ? <span className="text-muted-foreground text-sm">{s.description}</span> : null}
                {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

```tsx
// staff.tsx
import { initials } from "@/features/scheduling/staff-slug";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

const CARD = "wt-surface flex flex-col items-center gap-2 rounded-[var(--widget-radius)] border p-4 text-center";

export function StaffSection({ section, ctx }: { section: SectionOf<"staff">; ctx: RenderContext }) {
  if (ctx.lockedStaff) return null;
  if (ctx.staff.length < 2) return <Ghost mode={ctx.mode} label="Shows once two or more team members are bookable" />;
  return (
    <section className="flex flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ctx.staff.map((p) => {
          const body = (
            <>
              <span aria-hidden className="flex size-12 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: p.color }}>
                {initials(p.name)}
              </span>
              <span className="text-sm font-medium">{p.name}</span>
            </>
          );
          return (
            <li key={p.id}>
              {ctx.mode === "preview" ? <div className={CARD}>{body}</div> : <a href={`/book/${ctx.org.handle}/${p.slug}`} className={CARD}>{body}</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

```tsx
// booking.tsx
"use client";

import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { usePageState } from "../page-state";

export function BookingSection({ section, ctx }: { section: SectionOf<"booking">; ctx: RenderContext }) {
  const { requested } = usePageState();
  const preview = ctx.mode === "preview";
  return (
    <section id="book" className="flex scroll-mt-6 flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      {/* The widget's own surface: transparent unless the org set a background
          override — exactly the wrapper /book used before the builder. The page
          above carries the same theme (always transparent) for the other sections. */}
      <WidgetTheme config={ctx.theme} accentColor={ctx.branding.accentColor} transparent={!ctx.theme.background}>
        <BookingWidget
          handle={preview ? "preview" : ctx.org.handle}
          orgTimeZone={ctx.org.timeZone}
          services={ctx.services}
          // Preview mode stays exactly what the old studio rendered: no staff
          // step, no rentals, canned slots, never a network call.
          offerings={preview ? [] : ctx.offerings}
          staff={preview ? [] : ctx.staff}
          serviceStaffIds={preview ? undefined : ctx.serviceStaffIds}
          lockedStaff={preview ? null : ctx.lockedStaff}
          requestedService={requested}
          preview={preview && ctx.previewSlots ? { slots: ctx.previewSlots } : undefined}
        />
      </WidgetTheme>
    </section>
  );
}
```

- [ ] **Step 2: Page renderer**

```tsx
// src/features/booking-page/render/page-renderer.tsx
import { cn } from "@/lib/utils";
import type { PageDocument, Section } from "../schema";
import { publicSections } from "../doc-ops";
import type { RenderContext } from "./context";
import { PageStateProvider } from "./page-state";
import { SectionFrame } from "./section-frame";
import { HeaderSection } from "./sections/header";
import { HeroSection } from "./sections/hero";
import { AboutSection } from "./sections/about";
import { ServicesSection } from "./sections/services";
import { StaffSection } from "./sections/staff";
import { GallerySection } from "./sections/gallery";
import { TestimonialsSection } from "./sections/testimonials";
import { FaqSection } from "./sections/faq";
import { LinksSection } from "./sections/links";
import { LocationSection } from "./sections/location";
import { BookingSection } from "./sections/booking";

/** Page column width per layout — the public <main> and the studio preview share it. */
export function pageContainerClass(layout: PageDocument["layout"]): string {
  return layout === "split" ? "max-w-5xl" : "max-w-lg";
}

function renderSection(section: Section, ctx: RenderContext) {
  switch (section.type) {
    case "header": return <HeaderSection section={section} ctx={ctx} />;
    case "hero": return <HeroSection section={section} ctx={ctx} />;
    case "about": return <AboutSection section={section} ctx={ctx} />;
    case "services": return <ServicesSection section={section} ctx={ctx} />;
    case "staff": return <StaffSection section={section} ctx={ctx} />;
    case "gallery": return <GallerySection section={section} ctx={ctx} />;
    case "testimonials": return <TestimonialsSection section={section} ctx={ctx} />;
    case "faq": return <FaqSection section={section} ctx={ctx} />;
    case "links": return <LinksSection section={section} ctx={ctx} />;
    case "location": return <LocationSection section={section} ctx={ctx} />;
    case "booking": return <BookingSection section={section} ctx={ctx} />;
  }
}

// Split layout, container-query driven (@3xl = 48rem of the page column, not
// the viewport) so the studio preview and its phone toggle behave like the
// real page. The booking section docks in column 2 and spans every explicit
// row (gridTemplateRows below); the rest auto-place down column 1. Below
// @3xl the container is a plain flex column in DOM (= array) order.
const DOCKED = "@3xl:col-start-2 @3xl:row-start-1 @3xl:row-end-[-1] @3xl:sticky @3xl:top-6 @3xl:self-start";

/* One renderer for /book/[handle], staff pages, the studio preview and
   template thumbnails. Public mode drops hidden and empty sections; preview
   mode shows everything (hidden ones dimmed) so each can be selected. */
export function PageRenderer({ doc, ctx, initialServiceId = null }: { doc: PageDocument; ctx: RenderContext; initialServiceId?: string | null }) {
  const sections =
    ctx.mode === "public"
      ? publicSections(doc, { serviceCount: ctx.services.length, staffCount: ctx.lockedStaff ? 0 : ctx.staff.length })
      : doc.sections;
  const split = doc.layout === "split";
  const others = sections.filter((s) => s.type !== "booking").length;
  return (
    <PageStateProvider initialServiceId={initialServiceId}>
      <div
        className={cn("@container flex w-full flex-col gap-8", split && "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] @3xl:gap-x-10")}
        style={split ? { gridTemplateRows: `repeat(${Math.max(others, 1)}, auto)` } : undefined}
      >
        {sections.map((section) => {
          const docked = split && section.type === "booking";
          const inner = renderSection(section, ctx);
          return ctx.mode === "preview" ? (
            <SectionFrame key={section.id} id={section.id} type={section.type} hidden={section.hidden} className={cn(docked && DOCKED)}>
              {inner}
            </SectionFrame>
          ) : (
            <div key={section.id} className={cn(docked && DOCKED)}>{inner}</div>
          );
        })}
      </div>
    </PageStateProvider>
  );
}
```

- [ ] **Step 3: Verify** — `npm run verify`. Expected: PASS. If `initials` is not exported from `@/features/scheduling/staff-slug` under that name, grep the file for the export the widget uses (`booking-widget.tsx` imports it as `initials`) and use that.

- [ ] **Step 4: Commit**

```bash
git add src/features/booking-page/render
git commit -m "feat(booking-page): live sections and PageRenderer with split layout"
```

---

### Task 9: Public pages render the published document

**Files:**
- Modify: `src/app/book/[handle]/page.tsx` (whole file), `src/app/book/[handle]/[staffSlug]/page.tsx` (whole file)

**Interfaces:**
- Consumes: `getPublishedPage` (Task 5), `pageMetadata` (Task 6), `resolveInitialService` (Task 6), `PageRenderer`, `pageContainerClass` (Task 8), `RenderContext` (Task 7).
- Behaviour preserved: handle regex, every `notFound()` rule, the badge rule, `bookShellClass`, the embed route untouched.

- [ ] **Step 1: Rewrite `/book/[handle]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingOrg, listPublicOfferings } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { getOrgBranding } from "@/lib/org-branding";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { badgeVisible } from "@/lib/billing/entitlements";
import { PoweredBy } from "@/components/powered-by";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { resolveInitialService } from "@/features/booking-page/initial-service";
import type { RenderContext } from "@/features/booking-page/render/context";
import { PageRenderer, pageContainerClass } from "@/features/booking-page/render/page-renderer";

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export async function generateMetadata({ params }: PageProps<"/book/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  return pageMetadata(await getPublishedPage(org.orgId), org, env.NEXT_PUBLIC_SUPABASE_URL);
}

export default async function BookPage({ params, searchParams }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [offering, offerings, branding, doc] = await Promise.all([
    // The org's roster and services, already narrowed to what someone active
    // can be booked for AND to what the org's plan may offer publicly.
    loadPublicOffering(org.orgId),
    // Rentals parked unless the org's `rentals` flag is on (lib/flags): the widget lists services only.
    getOrgFlagsAdmin(org.orgId).then((f) => (f.rentals ? listPublicOfferings(org.orgId) : [])),
    getOrgBranding(org.orgId),
    // The org's published composition; the default page when none.
    getPublishedPage(org.orgId),
  ]);
  const { services, staff, serviceStaffIds } = offering;
  if (services.length === 0 && offerings.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  const initialServiceId = resolveInitialService(services, (await searchParams).service);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services, staff, serviceStaffIds, offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public",
  };
  return (
    // The whole page takes the org's widget theme (light / dark / auto), so
    // the transparent widget always sits on a matching surface — the same
    // guarantee the embed can't give on a third-party site.
    <div className={bookShellClass(theme.theme)}>
      {/* Theme tokens (font, radius, accent, text, lines) for every section;
          always transparent — the shell paints the ground. The booking
          section nests its own WidgetTheme for the widget's surface. */}
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 p-6", pageContainerClass(doc.layout))}>
          <PageRenderer doc={doc} ctx={ctx} initialServiceId={initialServiceId} />
          {/* Same rule as the embed: the badge shows unless the org both asked
              to hide it and is on a plan that may (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `/book/[handle]/[staffSlug]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingOrg } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { filterBookableServices } from "@/lib/booking/bookable";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { getOrgBranding } from "@/lib/org-branding";
import { badgeVisible } from "@/lib/billing/entitlements";
import { PoweredBy } from "@/components/powered-by";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { resolveInitialService } from "@/features/booking-page/initial-service";
import type { RenderContext } from "@/features/booking-page/render/context";
import { PageRenderer, pageContainerClass } from "@/features/booking-page/render/page-renderer";

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export async function generateMetadata({ params }: PageProps<"/book/[handle]/[staffSlug]">): Promise<Metadata> {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle) || !STAFF_SLUG_RE.test(staffSlug)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  return pageMetadata(await getPublishedPage(org.orgId), org, env.NEXT_PUBLIC_SUPABASE_URL);
}

// One team member's own booking link: the org's published page with the
// staff section dropped (PageRenderer: lockedStaff ⇒ staffCount 0) and the
// widget locked to this person — only their services, no staff step, no
// "Anyone available". Rentals are org-level, so this page never lists them.
export default async function StaffBookPage({ params, searchParams }: PageProps<"/book/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  // Shape-checked before any DB call, exactly like the handle above.
  if (!STAFF_SLUG_RE.test(staffSlug)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [offering, branding, doc] = await Promise.all([
    loadPublicOffering(org.orgId),
    getOrgBranding(org.orgId),
    getPublishedPage(org.orgId),
  ]);
  // The roster is active-only AND plan-limited, so both a deactivated person
  // and one the plan no longer offers publicly 404 here — the link stays valid
  // and starts working again the moment they return to the roster.
  const person = offering.staff.find((s) => s.slug === staffSlug);
  if (!person) notFound();
  const services = filterBookableServices(offering.services, offering.serviceStaffIds, [person], person.id);
  // Nothing they can be booked for is not a page worth rendering.
  if (services.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  const initialServiceId = resolveInitialService(services, (await searchParams).service);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services,
    // No serviceStaffIds: the map is only needed to filter a staff step this
    // page never shows, and shipping the org's whole service→staff graph to
    // the browser for nothing is worse than letting eligibleFor fall back to
    // `staff` (= [person]).
    staff: [person], offerings: [], lockedStaff: person,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public",
  };
  return (
    <div className={bookShellClass(theme.theme)}>
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 p-6", pageContainerClass(doc.layout))}>
          <PageRenderer doc={doc} ctx={ctx} initialServiceId={initialServiceId} />
          {/* Same rule as /book/[handle] and the embed (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
```

- [ ] **Step 3: Verify + smoke** — `npm run verify`, then `npm run dev` and open `/book/<an existing handle>`: the page must look exactly as before (header + widget), `?service=<a real service uuid>` must preselect that service, and `/book/<handle>/<staff-slug>` must still show "Booking with X". Also confirm `/embed/<handle>` is unchanged.

- [ ] **Step 4: Commit**

```bash
git add "src/app/book/[handle]/page.tsx" "src/app/book/[handle]/[staffSlug]/page.tsx"
git commit -m "feat(booking-page): public pages render the published document with metadata and ?service="
```

---

### Task 10: Image upload action and orphan cleanup

**Files:**
- Modify: `src/features/booking-page/actions.ts` (add `uploadPageImage`, `cleanupOrphans`; call it from publish/discard)

**Interfaces:**
- Produces: `uploadPageImage(formData): Promise<UploadResult>` where `type UploadResult = { ok: true; path: string } | { ok: false; error: string }`.
- Consumes: `matchesLogoMagicBytes` (`@/lib/storage/logo`), `uploadBrandingObject`, `BRANDING_BUCKET` (`@/lib/storage/branding`), `createAdminClient`, `PAGE_IMAGE_MAX_BYTES`, `isAllowedPageImageType`, `pageImagePathFor`, `pageImagePrefix`, `imagePathsIn`, `orphanPaths` (Task 1), `IMAGE_REJECTED_ERROR` (Task 2), `getPageDraftState` (Task 5).

The pure parts (path, diff) are tested in Task 1; storage I/O is exercised manually in Task 17 (the slice-8 / logo precedent: no storage integration tests in the repo).

- [ ] **Step 1: Add the upload action** — merge these into the import block of `actions.ts` (the `./schema` and `./images` lines replace the existing ones):

```ts
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchesLogoMagicBytes } from "@/lib/storage/logo";
import { BRANDING_BUCKET, uploadBrandingObject } from "@/lib/storage/branding";
import { getPageDraftState } from "./queries";
import { pageDocumentSchema, PAGE_TOO_LARGE_ERROR, IMAGE_REJECTED_ERROR, type PageDocument } from "./schema";
import {
  PAGE_IMAGE_MAX_BYTES, isAllowedPageImageType, pageImagePathFor, pageImagePrefix, imagePathsIn, orphanPaths,
} from "./images";
```

and append:

```ts
export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

/** Uploads one page image and returns its storage path; the draft references
    it, nothing is written to the DB here. Mirrors uploadLogo: declared type
    → size → buffered size → magic bytes → content-hashed path → upsert. */
export async function uploadPageImage(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: GENERIC_WRITE_ERROR };
  if (file.size === 0 || file.size > PAGE_IMAGE_MAX_BYTES || !isAllowedPageImageType(file.type)) {
    return { ok: false, error: IMAGE_REJECTED_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const bytes = await file.arrayBuffer();
  // Re-check the buffered bytes, not just the File's reported size.
  if (bytes.byteLength === 0 || bytes.byteLength > PAGE_IMAGE_MAX_BYTES) return { ok: false, error: IMAGE_REJECTED_ERROR };
  // `branding` is a public, directly-navigable bucket: a relabeled file (SVG
  // as image/png) must be caught here, before it ever reaches storage.
  if (!matchesLogoMagicBytes(new Uint8Array(bytes), file.type)) return { ok: false, error: IMAGE_REJECTED_ERROR };
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = pageImagePathFor(orgId, checksum, file.type);
  if (!path) return { ok: false, error: IMAGE_REJECTED_ERROR };
  if (!(await uploadBrandingObject(path, bytes, file.type))) return { ok: false, error: GENERIC_WRITE_ERROR };
  return { ok: true, path };
}

/** Best-effort: delete objects under the org's page prefix that neither
    document references. Never throws, never fails the caller — the next
    publish/discard retries (evidence.ts orphan doctrine). */
async function cleanupOrphans(orgId: string, draft: PageDocument, published: PageDocument | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const prefix = pageImagePrefix(orgId);
    const { data, error } = await admin.storage.from(BRANDING_BUCKET).list(prefix.slice(0, -1), { limit: 1000 });
    if (error) {
      console.error("[booking-page] orphan list failed:", error.message);
      return;
    }
    const listed = (data ?? []).map((o) => `${prefix}${o.name}`);
    const referenced = [...imagePathsIn(draft), ...(published ? imagePathsIn(published) : [])];
    const orphans = orphanPaths(listed, referenced);
    if (orphans.length === 0) return;
    const { error: removeError } = await admin.storage.from(BRANDING_BUCKET).remove(orphans);
    if (removeError) console.error("[booking-page] orphan delete failed:", removeError.message);
  } catch (error) {
    console.error("[booking-page] orphan cleanup threw:", error);
  }
}
```

- [ ] **Step 2: Call it** — in `publishBookingPage`, after the publish RPC succeeds and before `revalidatePath`:

```ts
  // Published == draft now: anything else under the prefix is an orphan.
  await cleanupOrphans(orgId, doc, doc);
```

In `discardBookingPageDraft`, after the discard RPC succeeds and before `revalidatePath`:

```ts
  const state = await getPageDraftState(orgId);
  await cleanupOrphans(orgId, state.draft, state.published);
```

- [ ] **Step 3: Verify** — `npm run verify` (PASS). Then with the dev server running, call the action from a one-off client (or wait for Task 13's image field) — the manual checklist in Task 17 covers: upload PNG ok, SVG-as-PNG rejected with the image copy, 6 MB rejected, re-upload is idempotent, publish removes an image dropped from the draft.

- [ ] **Step 4: Commit**

```bash
git add src/features/booking-page/actions.ts
git commit -m "feat(booking-page): page image upload and orphan cleanup on publish/discard"
```

---

### Task 11: `pageSections` entitlement (wired, permissive)

**Files:**
- Modify: `src/lib/billing/plans.ts:8-21` (`PlanLimits`), `:34` (`PAID_LIMITS`), `:37-42` (free limits)
- Create: `src/features/booking-page/gating.ts`
- Modify: `src/features/booking-page/queries.ts` (add `getPageSectionsEntitlement`), `src/features/booking-page/actions.ts` (publish check)
- Test: `src/features/booking-page/gating.test.ts`

**Interfaces:**
- Produces: `PlanLimits.pageSections: "basic" | "all"` (every plan `"all"` in v1), `BASIC_SECTION_TYPES`, `sectionAllowed(type, ent)`, `gatedVisibleSections(doc, ent)`, `getPageSectionsEntitlement(orgId): Promise<"basic" | "all">` (fails open to `"all"`), publish refuses with `PAGE_GATED_ERROR`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/booking-page/gating.test.ts
import { describe, it, expect } from "vitest";
import { sectionAllowed, gatedVisibleSections, BASIC_SECTION_TYPES } from "./gating";
import { DEFAULT_PAGE, newSection, ADDABLE_TYPES } from "./defaults";
import { PLANS } from "@/lib/billing/plans";

describe("pageSections gating", () => {
  it("basic = header, booking, about, links; all = everything", () => {
    for (const t of [...ADDABLE_TYPES, "booking"] as const) {
      expect(sectionAllowed(t, { pageSections: "all" })).toBe(true);
      expect(sectionAllowed(t, { pageSections: "basic" })).toBe(BASIC_SECTION_TYPES.has(t));
    }
  });
  it("gatedVisibleSections ignores hidden sections", () => {
    const gallery = newSection("gallery");
    const hiddenFaq = { ...newSection("faq"), hidden: true };
    const doc = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, gallery, hiddenFaq, DEFAULT_PAGE.sections[1]!] };
    expect(gatedVisibleSections(doc, { pageSections: "basic" }).map((s) => s.type)).toEqual(["gallery"]);
    expect(gatedVisibleSections(doc, { pageSections: "all" })).toEqual([]);
  });
  it("every plan allows everything in v1", () => {
    for (const plan of Object.values(PLANS)) expect(plan.limits.pageSections).toBe("all");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/booking-page/gating.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `plans.ts` add to `PlanLimits` (after `hideBadge`):

```ts
  /** Which booking-page sections may be published: "basic" = header, booking,
      about, links (a link-in-bio page); "all" = the whole catalogue. Every
      plan is "all" for now — the gate is wired so flipping it is a one-line change. */
  pageSections: "basic" | "all";
```

add `pageSections: "all"` to `PAID_LIMITS` and to the `free` plan's `limits` object, then:

```ts
// src/features/booking-page/gating.ts
// The pageSections entitlement rule — pure, so the palette (client), the
// publish action (server) and the tests share one answer.
import type { PlanLimits } from "@/lib/billing/plans";
import type { PageDocument, Section, SectionType } from "./schema";

export const BASIC_SECTION_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["header", "booking", "about", "links"]);

export function sectionAllowed(type: SectionType, ent: Pick<PlanLimits, "pageSections">): boolean {
  return ent.pageSections === "all" || BASIC_SECTION_TYPES.has(type);
}

/** Visible sections the plan does not allow — what blocks Publish. */
export function gatedVisibleSections(doc: PageDocument, ent: Pick<PlanLimits, "pageSections">): Section[] {
  return doc.sections.filter((s) => !s.hidden && !sectionAllowed(s.type, ent));
}
```

In `queries.ts` add (mirrors `badgeToggleEnabled` in `src/app/(dashboard)/embed/page.tsx` — both reads inside the try, fails open):

```ts
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getEntitlements } from "@/lib/billing/queries";
import type { PlanLimits } from "@/lib/billing/plans";

/** Fails OPEN: a billing hiccup must never block publishing a page. */
export async function getPageSectionsEntitlement(orgId: string): Promise<PlanLimits["pageSections"]> {
  try {
    if (!(await getDashboardFlags(orgId)).billing) return "all";
    return (await getEntitlements(orgId, await createClient())).pageSections;
  } catch (error) {
    console.error("[billing] page-sections read failed — publish proceeds:", error);
    return "all";
  }
}
```

In `actions.ts` import `gatedVisibleSections` from `./gating`, `getPageSectionsEntitlement` from `./queries`, `PAGE_GATED_ERROR` from `./schema`, and in `publishBookingPage` right after `validateDocument` succeeds:

```ts
  const pageSections = await getPageSectionsEntitlement(orgId);
  if (gatedVisibleSections(doc, { pageSections }).length > 0) return { ok: false, error: PAGE_GATED_ERROR };
```

- [ ] **Step 4: Run tests + verify** — `npx vitest run src/features/booking-page/gating.test.ts` (PASS), `npm run verify` (PASS — if the pricing page or billing tests enumerate `PlanLimits` keys exhaustively, the typecheck/test output names the file; add `pageSections` there the same way `intakeQuestions` appears).

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/plans.ts src/features/booking-page/gating.ts src/features/booking-page/gating.test.ts src/features/booking-page/queries.ts src/features/booking-page/actions.ts
git commit -m "feat(billing): pageSections entitlement wired through booking-page publish (all plans allow all)"
```

---

### Task 12: dnd-kit dependencies and the draft hook

**Files:**
- Modify: `package.json` (via npm)
- Create: `src/features/booking-page/studio/use-page-draft.ts`

**Interfaces:**
- Produces: `usePageDraft(initial: { draft; published }): PageDraft` with `{ doc, update(next | updater), published, status: SaveStatus, issues: IssueMap, busy, retry(), publish(), discard(), unpublished }`; `type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid"`; `type PageDraft = ReturnType<typeof usePageDraft>`.
- Consumes: actions (Task 5), `pageDocumentSchema`, `DEFAULT_PAGE`, `deepEqual`, `hasUnpublishedChanges`, `issuesBySection` (Task 3).

- [ ] **Step 1: Install**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: three new `dependencies` entries; `npm run verify` still passes.

- [ ] **Step 2: Implement the hook**

```ts
// src/features/booking-page/studio/use-page-draft.ts
"use client";

import * as React from "react";
import { toast } from "sonner";
import { saveBookingPageDraft, publishBookingPage, discardBookingPageDraft } from "../actions";
import { pageDocumentSchema, type PageDocument } from "../schema";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual, hasUnpublishedChanges, issuesBySection, type IssueMap } from "../doc-ops";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";
const AUTOSAVE_MS = 800;

/* The studio's draft: local state first (the preview follows instantly),
   autosave debounced, the whole document validated before every write so the
   RPC only ever sees valid documents. Publish sends the current local doc
   (the action saves then publishes); discard reverts to the last published
   document, or the default page when never published. */
export function usePageDraft(initial: { draft: PageDocument; published: PageDocument | null }) {
  const [doc, setDoc] = React.useState(initial.draft);
  const [published, setPublished] = React.useState(initial.published);
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [issues, setIssues] = React.useState<IssueMap>({});
  const [busy, startTransition] = React.useTransition();
  const docRef = React.useRef(doc);
  const lastSaved = React.useRef(initial.draft);
  const timer = React.useRef<number | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const validate = React.useCallback((candidate: PageDocument): PageDocument | null => {
    const parsed = pageDocumentSchema.safeParse(candidate);
    if (parsed.success) {
      setIssues({});
      return parsed.data;
    }
    setIssues(issuesBySection(candidate, parsed.error.issues));
    setStatus("invalid");
    return null;
  }, []);

  const flush = React.useCallback(() => {
    clearTimer();
    const valid = validate(docRef.current);
    if (!valid) return;
    if (deepEqual(valid, lastSaved.current)) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      const result = await saveBookingPageDraft(valid);
      if (result.ok) {
        lastSaved.current = valid;
        // Edits may have landed while saving: then we are "idle" with a timer pending.
        setStatus(deepEqual(docRef.current, valid) ? "saved" : "idle");
      } else {
        setStatus("error");
        toast.error(result.error);
      }
    });
  }, [validate, clearTimer, startTransition]);

  const update = React.useCallback(
    (next: PageDocument | ((prev: PageDocument) => PageDocument)) => {
      const resolved = typeof next === "function" ? next(docRef.current) : next;
      docRef.current = resolved;
      setDoc(resolved);
      setStatus("idle");
      clearTimer();
      timer.current = window.setTimeout(flush, AUTOSAVE_MS);
    },
    [flush, clearTimer],
  );

  // Unmount: drop a pending autosave (the draft is re-read on next visit).
  React.useEffect(() => clearTimer, [clearTimer]);

  const publish = React.useCallback(() => {
    clearTimer();
    const valid = validate(docRef.current);
    if (!valid) {
      toast.error("Fix the highlighted fields before publishing.");
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      const result = await publishBookingPage(valid);
      if (!result.ok) {
        setStatus("error");
        toast.error(result.error);
        return;
      }
      lastSaved.current = valid;
      setPublished(valid);
      setStatus("saved");
      toast.success("Page published");
    });
  }, [validate, clearTimer, startTransition]);

  const discard = React.useCallback(() => {
    clearTimer();
    startTransition(async () => {
      const result = await discardBookingPageDraft();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const restored = published ?? DEFAULT_PAGE;
      docRef.current = restored;
      lastSaved.current = restored;
      setDoc(restored);
      setIssues({});
      setStatus("saved");
      toast.success("Draft discarded");
    });
  }, [published, clearTimer, startTransition]);

  return {
    doc, update, published, status, issues, busy,
    retry: flush, publish, discard,
    unpublished: hasUnpublishedChanges(doc, published),
  };
}

export type PageDraft = ReturnType<typeof usePageDraft>;
```

- [ ] **Step 3: Verify** — `npm run verify` (PASS).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/features/booking-page/studio/use-page-draft.ts
git commit -m "feat(booking-page): dnd-kit deps and the usePageDraft autosave/publish hook"
```

---

### Task 13: Inspector — fields, image upload control, one form per section type

**Files:**
- Create: `src/features/booking-page/studio/fields.tsx`, `studio/image-field.tsx`, `studio/forms/types.ts`, `studio/forms/{header,hero,about,services,staff,gallery,testimonials,faq,links,location,booking}.tsx`, `studio/section-inspector.tsx`

**Interfaces:**
- Produces: `TextField`, `TextAreaField`, `SelectField`, `CheckboxField`, `ListEditor`, `FieldError`; `ImageField({ id, label, path, supabaseUrl, onChange, shape? })`; `FormProps<T>` + `patch(section, changes)`; `<Type>Form(props: FormProps<T>)`; `SectionInspector({ section, issues, supabaseUrl, onChange, onBack })`.
- Consumes: `uploadPageImage` (Task 10), `PAGE_IMAGE_*`, `isAllowedPageImageType`, `pageImageUrl` (Task 1), `SectionOf`, `LINK_ICONS` (Task 2), `SECTION_META` (Task 2), `SettingsCard`/`SettingsRow`, `Input`, `Textarea`, `Checkbox`, `Button`.

- [ ] **Step 1: Field primitives**

```tsx
// src/features/booking-page/studio/fields.tsx
"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsRow } from "@/components/settings-row";

// Same class string every raw <select> in the app uses (scheduling-settings-form.tsx).
export const SELECT_CLASS =
  "border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-[11px]">{message}</p> : null;
}

export function TextField({
  id, label, value, onChange, max, error, hint, placeholder,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number;
  error?: string; hint?: React.ReactNode; placeholder?: string;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <Input id={id} value={value} maxLength={max} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </SettingsRow>
  );
}

export function TextAreaField({
  id, label, value, onChange, max, error, hint, placeholder, rows = 4,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number;
  error?: string; hint?: React.ReactNode; placeholder?: string; rows?: number;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <Textarea id={id} value={value} maxLength={max} rows={rows} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </SettingsRow>
  );
}

export function SelectField<T extends string>({
  id, label, value, onChange, options, hint,
}: {
  id: string; label: string; value: T; onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>; hint?: React.ReactNode;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={SELECT_CLASS}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </SettingsRow>
  );
}

export function CheckboxField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 px-4 py-3 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

/* Inline list editor for the repeating props (quotes, questions, links,
   gallery captions): add / remove / move up / move down. No nested
   drag-and-drop on purpose. */
export function ListEditor<T>({
  items, onChange, max, render, blank, addLabel, hideAdd = false,
}: {
  items: T[]; onChange: (items: T[]) => void; max: number;
  render: (item: T, set: (next: T) => void, index: number) => React.ReactNode;
  blank: () => T; addLabel: string;
  /** Gallery: rows are added by uploading, not by a blank row. */
  hideAdd?: boolean;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
          {render(item, (next) => onChange(items.map((it, k) => (k === i ? next : it))), i)}
          <div className="flex items-center justify-end gap-1">
            <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="size-3.5" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ChevronDown className="size-3.5" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}><Trash2 className="size-3.5" /></Button>
          </div>
        </div>
      ))}
      {hideAdd ? null : (
        <Button size="sm" variant="outline" disabled={items.length >= max} onClick={() => onChange([...items, blank()])}>
          <Plus className="size-3.5" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Image field**

```tsx
// src/features/booking-page/studio/image-field.tsx
"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/settings-row";
import { cn } from "@/lib/utils";
import { uploadPageImage } from "../actions";
import { PAGE_IMAGE_ACCEPT, PAGE_IMAGE_MAX_BYTES, isAllowedPageImageType, pageImageUrl } from "../images";
import { FieldError } from "./fields";

export const IMAGE_HINT = "PNG, JPEG or WebP · max 5 MB · best under 2000 px wide.";

/** Client-side pre-check before any bytes move (branding-form precedent); the server re-validates the buffered bytes. */
export function preCheckImage(file: File): string | null {
  if (!isAllowedPageImageType(file.type)) return "PNG, JPEG or WebP only.";
  if (file.size > PAGE_IMAGE_MAX_BYTES) return "Images must be 5 MB or less.";
  return null;
}

/* Single-image control (cover, photo): thumbnail + Upload/Replace + Remove. */
export function ImageField({
  id, label, path, supabaseUrl, onChange, shape = "wide",
}: {
  id: string; label: string; path: string | undefined; supabaseUrl: string;
  onChange: (path: string | undefined) => void; shape?: "wide" | "square";
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = preCheckImage(file);
    if (problem) {
      setError(problem);
      e.target.value = "";
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadPageImage(formData);
      if (!result.ok) setError(result.error);
      else onChange(result.path);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <SettingsRow label={label} hint={IMAGE_HINT}>
      <div className="flex items-center gap-2">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pageImageUrl(supabaseUrl, path)} alt="" className={cn("bg-background rounded border object-cover", shape === "square" ? "size-12" : "h-12 w-20")} />
        ) : null}
        <input ref={fileRef} id={id} type="file" accept={PAGE_IMAGE_ACCEPT} onChange={onFile} disabled={pending} className="sr-only" />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
          <HugeiconsIcon icon={Upload04Icon} size={14} />
          {pending ? "Uploading…" : path ? "Replace" : "Upload"}
        </Button>
        {path ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onChange(undefined)}>Remove</Button>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </SettingsRow>
  );
}
```

- [ ] **Step 3: Form props + the eleven forms**

```ts
// src/features/booking-page/studio/forms/types.ts
import type { Section, SectionOf, SectionType } from "../../schema";

export type FormProps<T extends SectionType> = {
  section: SectionOf<T>;
  /** zod messages keyed by relative field path ("headline", "items.2.url"). */
  issues: Record<string, string>;
  supabaseUrl: string;
  onChange: (next: SectionOf<T>) => void;
};

export function patch<T extends Section>(section: T, changes: Partial<T>): T {
  return { ...section, ...changes };
}
```

```tsx
// header.tsx
"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function HeaderForm({ section, issues, onChange }: FormProps<"header">) {
  return (
    <TextField id="sec-tagline" label="Tagline" value={section.tagline} max={120} error={issues.tagline} placeholder="Colour specialist in Kraków" hint="Shown under your name. Logo and accent are on the Settings tab." onChange={(v) => onChange(patch(section, { tagline: v }))} />
  );
}
```

```tsx
// hero.tsx
"use client";
import { SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function HeroForm({ section, issues, supabaseUrl, onChange }: FormProps<"hero">) {
  return (
    <>
      <ImageField id="sec-hero-image" label="Cover image" path={section.imagePath} supabaseUrl={supabaseUrl} onChange={(imagePath) => onChange(patch(section, { imagePath }))} />
      <TextField id="sec-hero-headline" label="Headline" value={section.headline} max={80} error={issues.headline} placeholder="Hair & colour by Anna" onChange={(v) => onChange(patch(section, { headline: v }))} />
      <TextField id="sec-hero-sub" label="Subheadline" value={section.subheadline} max={160} error={issues.subheadline} onChange={(v) => onChange(patch(section, { subheadline: v }))} />
      <SelectField id="sec-hero-align" label="Alignment" value={section.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centered" }]} onChange={(align) => onChange(patch(section, { align }))} />
    </>
  );
}
```

```tsx
// about.tsx
"use client";
import { TextAreaField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function AboutForm({ section, issues, supabaseUrl, onChange }: FormProps<"about">) {
  return (
    <>
      <ImageField id="sec-about-photo" label="Photo" shape="square" path={section.photoPath} supabaseUrl={supabaseUrl} onChange={(photoPath) => onChange(patch(section, { photoPath }))} />
      <TextField id="sec-about-title" label="Title" value={section.title} max={60} error={issues.title} placeholder="About me" onChange={(v) => onChange(patch(section, { title: v }))} />
      <TextAreaField id="sec-about-body" label="Text" value={section.body} max={2000} rows={8} error={issues.body} hint="Blank line = new paragraph." onChange={(v) => onChange(patch(section, { body: v }))} />
    </>
  );
}
```

```tsx
// services.tsx
"use client";
import { CheckboxField, SelectField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function ServicesForm({ section, issues, onChange }: FormProps<"services">) {
  return (
    <>
      <TextField id="sec-services-title" label="Title" value={section.title} max={60} error={issues.title} onChange={(v) => onChange(patch(section, { title: v }))} />
      <SelectField id="sec-services-style" label="Style" value={section.style} options={[{ value: "list", label: "List" }, { value: "cards", label: "Cards" }]} onChange={(style) => onChange(patch(section, { style }))} />
      <CheckboxField id="sec-services-prices" label="Show prices" checked={section.showPrices} onChange={(showPrices) => onChange(patch(section, { showPrices }))} />
      <CheckboxField id="sec-services-durations" label="Show durations" checked={section.showDurations} onChange={(showDurations) => onChange(patch(section, { showDurations }))} />
    </>
  );
}
```

```tsx
// staff.tsx
"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function StaffForm({ section, issues, onChange }: FormProps<"staff">) {
  return (
    <TextField id="sec-staff-title" label="Title" value={section.title} max={60} error={issues.title} hint="Shows once two or more team members are bookable; clicking a person opens their own booking link." onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
```

```tsx
// gallery.tsx
"use client";
import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/components/settings-row";
import { uploadPageImage } from "../../actions";
import { PAGE_IMAGE_ACCEPT, pageImageUrl } from "../../images";
import { FieldError, ListEditor, SelectField } from "../fields";
import { IMAGE_HINT, preCheckImage } from "../image-field";
import { patch, type FormProps } from "./types";

const MAX_IMAGES = 12;

export function GalleryForm({ section, issues, supabaseUrl, onChange }: FormProps<"gallery">) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const room = MAX_IMAGES - section.images.length;

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, room);
    if (files.length === 0) return;
    const problem = files.map(preCheckImage).find(Boolean);
    if (problem) {
      setError(problem);
      e.target.value = "";
      return;
    }
    setError(null);
    startTransition(async () => {
      // Sequential so the order in the gallery matches the pick order.
      let next = section.images;
      for (const file of files) {
        const formData = new FormData();
        formData.set("file", file);
        const result = await uploadPageImage(formData);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        next = [...next, { path: result.path, alt: "" }];
        onChange(patch(section, { images: next }));
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <>
      <SelectField id="sec-gallery-columns" label="Columns" value={String(section.columns) as "2" | "3"} options={[{ value: "2", label: "Two" }, { value: "3", label: "Three" }]} onChange={(v) => onChange(patch(section, { columns: v === "2" ? 2 : 3 }))} />
      <SettingsRow label="Photos" hint={`${IMAGE_HINT} Up to ${MAX_IMAGES}.`}>
        <input ref={fileRef} type="file" multiple accept={PAGE_IMAGE_ACCEPT} onChange={onFiles} disabled={pending || room === 0} className="sr-only" />
        <Button variant="outline" size="sm" disabled={pending || room === 0} onClick={() => fileRef.current?.click()}>
          <HugeiconsIcon icon={Upload04Icon} size={14} />
          {pending ? "Uploading…" : "Add photos"}
        </Button>
        <FieldError message={error ?? issues.images} />
      </SettingsRow>
      <ListEditor
        items={section.images}
        max={MAX_IMAGES}
        hideAdd
        addLabel="Add photo"
        blank={() => ({ path: "", alt: "" })}
        onChange={(images) => onChange(patch(section, { images }))}
        render={(img, set, i) => (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pageImageUrl(supabaseUrl, img.path)} alt="" className="bg-background size-12 shrink-0 rounded border object-cover" />
            <Input value={img.alt} maxLength={120} placeholder="Describe the photo (alt text)" aria-label={`Photo ${i + 1} description`} onChange={(e) => set({ ...img, alt: e.target.value })} />
          </div>
        )}
      />
    </>
  );
}
```

```tsx
// testimonials.tsx
"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, ListEditor } from "../fields";
import { patch, type FormProps } from "./types";

export function TestimonialsForm({ section, issues, onChange }: FormProps<"testimonials">) {
  return (
    <ListEditor
      items={section.items}
      max={6}
      addLabel="Add quote"
      blank={() => ({ quote: "", author: "" })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <Textarea value={item.quote} maxLength={300} rows={3} placeholder="What did they say?" aria-label={`Quote ${i + 1}`} onChange={(e) => set({ ...item, quote: e.target.value })} />
          <FieldError message={issues[`items.${i}.quote`]} />
          <Input value={item.author} maxLength={60} placeholder="Who said it" aria-label={`Quote ${i + 1} author`} onChange={(e) => set({ ...item, author: e.target.value })} />
          <FieldError message={issues[`items.${i}.author`]} />
        </>
      )}
    />
  );
}
```

```tsx
// faq.tsx
"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, ListEditor } from "../fields";
import { patch, type FormProps } from "./types";

export function FaqForm({ section, issues, onChange }: FormProps<"faq">) {
  return (
    <ListEditor
      items={section.items}
      max={10}
      addLabel="Add question"
      blank={() => ({ q: "", a: "" })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <Input value={item.q} maxLength={120} placeholder="Question" aria-label={`Question ${i + 1}`} onChange={(e) => set({ ...item, q: e.target.value })} />
          <FieldError message={issues[`items.${i}.q`]} />
          <Textarea value={item.a} maxLength={600} rows={3} placeholder="Answer" aria-label={`Answer ${i + 1}`} onChange={(e) => set({ ...item, a: e.target.value })} />
          <FieldError message={issues[`items.${i}.a`]} />
        </>
      )}
    />
  );
}
```

```tsx
// links.tsx
"use client";
import { Input } from "@/components/ui/input";
import { LINK_ICONS, type LinkIcon } from "../../schema";
import { FieldError, ListEditor, SELECT_CLASS } from "../fields";
import { patch, type FormProps } from "./types";

const ICON_LABEL: Record<LinkIcon, string> = {
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp",
  website: "Website", phone: "Phone", email: "Email", other: "Other",
};
const PLACEHOLDER: Record<LinkIcon, string> = {
  instagram: "https://instagram.com/…", facebook: "https://facebook.com/…", tiktok: "https://tiktok.com/@…",
  whatsapp: "https://wa.me/48…", website: "https://…", phone: "tel:+48…", email: "mailto:you@example.com", other: "https://…",
};

export function LinksForm({ section, issues, onChange }: FormProps<"links">) {
  return (
    <ListEditor
      items={section.items}
      max={8}
      addLabel="Add link"
      blank={() => ({ label: "", url: "", icon: "website" as const })}
      onChange={(items) => onChange(patch(section, { items }))}
      render={(item, set, i) => (
        <>
          <div className="flex gap-2">
            <select value={item.icon} aria-label={`Link ${i + 1} type`} className={SELECT_CLASS} onChange={(e) => set({ ...item, icon: e.target.value as LinkIcon })}>
              {LINK_ICONS.map((icon) => (
                <option key={icon} value={icon}>{ICON_LABEL[icon]}</option>
              ))}
            </select>
            <Input value={item.label} maxLength={40} placeholder="Label" aria-label={`Link ${i + 1} label`} onChange={(e) => set({ ...item, label: e.target.value })} />
          </div>
          <FieldError message={issues[`items.${i}.label`]} />
          <Input value={item.url} maxLength={500} placeholder={PLACEHOLDER[item.icon]} aria-label={`Link ${i + 1} address`} onChange={(e) => set({ ...item, url: e.target.value })} />
          <FieldError message={issues[`items.${i}.url`]} />
        </>
      )}
    />
  );
}
```

```tsx
// location.tsx
"use client";
import { TextAreaField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function LocationForm({ section, issues, onChange }: FormProps<"location">) {
  return (
    <>
      <TextAreaField id="sec-location-address" label="Address" value={section.address} max={300} rows={3} error={issues.address} placeholder={"Main St 1\n00-001 Warsaw"} onChange={(v) => onChange(patch(section, { address: v }))} />
      <TextField id="sec-location-maps" label="Maps link" value={section.mapsUrl} max={500} error={issues.mapsUrl} placeholder="https://maps.app.goo.gl/…" hint="Shown as “Open in Maps”." onChange={(v) => onChange(patch(section, { mapsUrl: v }))} />
    </>
  );
}
```

```tsx
// booking.tsx
"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function BookingForm({ section, issues, onChange }: FormProps<"booking">) {
  return (
    <TextField id="sec-booking-title" label="Title" value={section.title} max={60} error={issues.title} placeholder="Book a time" hint="The widget itself is styled on the Settings tab and on Website embed." onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
```

- [ ] **Step 4: Inspector**

```tsx
// src/features/booking-page/studio/section-inspector.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import { SECTION_META } from "../defaults";
import type { Section } from "../schema";
import { HeaderForm } from "./forms/header";
import { HeroForm } from "./forms/hero";
import { AboutForm } from "./forms/about";
import { ServicesForm } from "./forms/services";
import { StaffForm } from "./forms/staff";
import { GalleryForm } from "./forms/gallery";
import { TestimonialsForm } from "./forms/testimonials";
import { FaqForm } from "./forms/faq";
import { LinksForm } from "./forms/links";
import { LocationForm } from "./forms/location";
import { BookingForm } from "./forms/booking";

/* The drilled-in left panel: one section's form. `onChange` receives the
   whole next section (replaceSection swaps it by id). */
export function SectionInspector({
  section, issues, supabaseUrl, onChange, onBack,
}: {
  section: Section; issues: Record<string, string>; supabaseUrl: string;
  onChange: (next: Section) => void; onBack: () => void;
}) {
  const common = { issues, supabaseUrl, onChange };
  const form = (() => {
    switch (section.type) {
      case "header": return <HeaderForm section={section} {...common} />;
      case "hero": return <HeroForm section={section} {...common} />;
      case "about": return <AboutForm section={section} {...common} />;
      case "services": return <ServicesForm section={section} {...common} />;
      case "staff": return <StaffForm section={section} {...common} />;
      case "gallery": return <GalleryForm section={section} {...common} />;
      case "testimonials": return <TestimonialsForm section={section} {...common} />;
      case "faq": return <FaqForm section={section} {...common} />;
      case "links": return <LinksForm section={section} {...common} />;
      case "location": return <LocationForm section={section} {...common} />;
      case "booking": return <BookingForm section={section} {...common} />;
    }
  })();
  return (
    <div className="flex flex-col gap-3">
      <Button size="xs" variant="ghost" className="w-fit" onClick={onBack}>
        <ChevronLeft className="size-3.5" /> Sections
      </Button>
      <SettingsCard title={SECTION_META[section.type].label} description={SECTION_META[section.type].description}>
        {form}
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 5: Verify** — `npm run verify` (PASS). `onChange: (next: Section) => void` is assignable to every form's `(next: SectionOf<T>) => void` by parameter contravariance; if TS complains about `{...common}` spreading, pass the three props explicitly per case.

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/studio
git commit -m "feat(booking-page): inspector forms, field primitives and image upload control"
```

---

### Task 14: Sections panel — tabs, publish bar, confirm dialog, sortable rows, palette, layout toggle

**Files:**
- Create: `src/features/booking-page/studio/studio-tabs.tsx`, `publish-bar.tsx`, `confirm-dialog.tsx`, `section-row.tsx`, `add-section-popover.tsx`, `layout-toggle.tsx`, `sections-panel.tsx`

**Interfaces:**
- Produces: `StudioTabs({ value, onChange })` + `type StudioTab`, `PublishBar(...)`, `ConfirmDialog(...)`, `SectionRow(...)`, `AddSectionPopover({ doc, pageSections, onAdd })`, `LayoutToggle({ value, onChange })`, `SectionsPanel({ draft, selectedId, onSelect, emptyContext, liveUrl, pageSections, templatePicker })`.
- Consumes: `PageDraft` (Task 12), doc-ops (Task 3), `SECTION_META`, `ADDABLE_TYPES`, `DEFAULT_PAGE` (Task 2), `sectionAllowed` (Task 11), `@dnd-kit/*`, `Dialog`/`Popover`/`Badge`/`Button`.

- [ ] **Step 1: Tabs, layout toggle, confirm dialog**

```tsx
// studio-tabs.tsx
"use client";

import { cn } from "@/lib/utils";

export type StudioTab = "sections" | "settings";
const TABS: ReadonlyArray<{ id: StudioTab; label: string }> = [
  { id: "sections", label: "Sections" },
  { id: "settings", label: "Settings" },
];

/* Local-state tab strip (staff-tabs.tsx look; there is no Tabs primitive).
   Sections = the draft → Publish model; Settings = saved-as-you-go. */
export function StudioTabs({ value, onChange }: { value: StudioTab; onChange: (tab: StudioTab) => void }) {
  return (
    <div role="tablist" aria-label="Booking page" className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "focus-visible:ring-ring/50 h-7 rounded-[6px] px-3 text-sm outline-none focus-visible:ring-2",
            value === t.id ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// layout-toggle.tsx
"use client";

import { cn } from "@/lib/utils";
import type { PageDocument } from "../schema";

type Layout = PageDocument["layout"];
const OPTIONS: ReadonlyArray<{ value: Layout; label: string; title: string }> = [
  { value: "column", label: "Column", title: "One column, like today's page" },
  { value: "split", label: "Split", title: "Booking docks to the right on wide screens" },
];

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="bg-secondary flex h-7 items-center gap-0.5 rounded-md border p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "focus-visible:ring-ring/50 h-6 rounded-[4px] px-2 text-xs outline-none focus-visible:ring-2",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// confirm-dialog.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* The repo had no confirm step anywhere; the builder needs one for Discard,
   "publish with empty sections" and "replace draft with a template". */
export function ConfirmDialog({
  open, title, description, confirmLabel, destructive = false, onConfirm, onClose,
}: {
  open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Publish bar**

```tsx
// publish-bar.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-page-draft";

const STATUS_LABEL: Record<SaveStatus, string | null> = {
  idle: null, saving: "Saving…", saved: "Saved", error: "Couldn't save", invalid: "Fix errors to save",
};

export function PublishBar({
  status, unpublished, neverPublished, busy, pageIssue, liveUrl, onRetry, onPublish, onDiscard,
}: {
  status: SaveStatus; unpublished: boolean; neverPublished: boolean; busy: boolean;
  /** Page-level zod message (exactly-one-booking etc.), if any. */
  pageIssue?: string; liveUrl: string | null;
  onRetry: () => void; onPublish: () => void; onDiscard: () => void;
}) {
  const label = STATUS_LABEL[status];
  const bad = status === "error" || status === "invalid";
  return (
    <div className="bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {neverPublished ? (
            <Badge variant="secondary">Not published yet</Badge>
          ) : unpublished ? (
            <Badge variant="secondary">Unpublished changes</Badge>
          ) : (
            <Badge variant="outline">Live</Badge>
          )}
          {label ? <span role="status" className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{label}</span> : null}
          {status === "error" ? <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button> : null}
        </div>
        {liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3">
            View live page
          </a>
        ) : null}
      </div>
      {pageIssue ? <p className="text-destructive text-xs">{pageIssue}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onPublish} disabled={busy || status === "invalid" || !unpublished}>Publish</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy || !unpublished}>Discard changes</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sortable row and palette**

```tsx
// section-row.tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SECTION_META } from "../defaults";
import { sectionSummary } from "../doc-ops";
import type { Section } from "../schema";

export function SectionRow({
  section, selected, issueCount, onSelect, onToggleHidden, onRemove,
}: {
  section: Section; selected: boolean; issueCount: number;
  onSelect: () => void; onToggleHidden: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const required = section.type === "booking";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "bg-card flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5",
        selected && "border-primary ring-1 ring-primary/30",
        isDragging && "opacity-60 shadow-md",
        section.hidden && "opacity-60",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${SECTION_META[section.type].label}`}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-0.5 text-left">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {SECTION_META[section.type].label}
          {required ? <Badge variant="outline">Required</Badge> : null}
          {issueCount > 0 ? <Badge variant="destructive">{issueCount}</Badge> : null}
        </span>
        <span className="text-muted-foreground w-full truncate text-xs">{sectionSummary(section)}</span>
      </button>
      {required ? null : (
        <>
          <Button size="icon-xs" variant="ghost" aria-label={section.hidden ? "Show section" : "Hide section"} aria-pressed={section.hidden} onClick={onToggleHidden}>
            {section.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Remove section" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
```

```tsx
// add-section-popover.tsx
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PlanLimits } from "@/lib/billing/plans";
import { ADDABLE_TYPES, SECTION_META } from "../defaults";
import { canAddSection } from "../doc-ops";
import { sectionAllowed } from "../gating";
import type { PageDocument, SectionType } from "../schema";

export function AddSectionPopover({
  doc, pageSections, onAdd,
}: {
  doc: PageDocument; pageSections: PlanLimits["pageSections"]; onAdd: (type: SectionType) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="size-3.5" /> Add section
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-2">
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {ADDABLE_TYPES.map((type) => {
            const can = canAddSection(doc, type);
            const allowed = sectionAllowed(type, { pageSections });
            const disabled = !can.ok || !allowed;
            return (
              <li key={type}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onAdd(type);
                    setOpen(false);
                  }}
                  className="hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {SECTION_META[type].label}
                    {!allowed ? <Badge variant="secondary">Pro</Badge> : null}
                  </span>
                  <span className="text-muted-foreground text-xs">{can.ok ? SECTION_META[type].description : can.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: The panel**

```tsx
// sections-panel.tsx
"use client";

import * as React from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_PAGE, SECTION_META } from "../defaults";
import {
  deepEqual, emptyVisibleSections, insertSection, moveSection, removeSection, setSectionHidden, type EmptyContext,
} from "../doc-ops";
import type { SectionType } from "../schema";
import { AddSectionPopover } from "./add-section-popover";
import { ConfirmDialog } from "./confirm-dialog";
import { LayoutToggle } from "./layout-toggle";
import { PublishBar } from "./publish-bar";
import { SectionRow } from "./section-row";
import type { PageDraft } from "./use-page-draft";

export function SectionsPanel({
  draft, selectedId, onSelect, emptyContext, liveUrl, pageSections, templatePicker,
}: {
  draft: PageDraft; selectedId: string | null; onSelect: (id: string | null) => void;
  emptyContext: EmptyContext; liveUrl: string | null; pageSections: PlanLimits["pageSections"];
  /** "Start from a template" (Task 16); null until then. */
  templatePicker: React.ReactNode;
}) {
  const { doc, update, status, issues, busy, retry, publish, discard, unpublished, published } = draft;
  const [confirm, setConfirm] = React.useState<"discard" | "publish" | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || over.id === e.active.id) return;
    update((d) => moveSection(d, String(e.active.id), String(over.id)));
  };
  const add = (type: SectionType) => {
    let newId = "";
    update((d) => {
      const inserted = insertSection(d, type, selectedId);
      newId = inserted.id;
      return inserted.doc;
    });
    onSelect(newId);
  };
  const empties = emptyVisibleSections(doc, emptyContext);
  const onPublishClick = () => (empties.length > 0 ? setConfirm("publish") : publish());

  return (
    <div className="flex flex-col gap-4">
      <PublishBar
        status={status}
        unpublished={unpublished}
        neverPublished={published === null}
        busy={busy}
        pageIssue={issues[""] ? Object.values(issues[""])[0] : undefined}
        liveUrl={liveUrl}
        onRetry={retry}
        onPublish={onPublishClick}
        onDiscard={() => setConfirm("discard")}
      />
      <div className="flex items-center justify-between gap-3">
        <LayoutToggle value={doc.layout} onChange={(layout) => update((d) => ({ ...d, layout }))} />
        {templatePicker}
      </div>
      {published === null && deepEqual(doc, DEFAULT_PAGE) ? (
        <p className="text-muted-foreground text-xs">This is the default page. Pick a template or add sections.</p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {doc.sections.map((s) => (
              <SectionRow
                key={s.id}
                section={s}
                selected={s.id === selectedId}
                issueCount={Object.keys(issues[s.id] ?? {}).length}
                onSelect={() => onSelect(s.id)}
                onToggleHidden={() => update((d) => setSectionHidden(d, s.id, !s.hidden))}
                onRemove={() => {
                  update((d) => removeSection(d, s.id));
                  if (selectedId === s.id) onSelect(null);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddSectionPopover doc={doc} pageSections={pageSections} onAdd={add} />
      <ConfirmDialog
        open={confirm === "discard"}
        title="Discard changes?"
        description={published ? "Your draft goes back to the published page." : "Your draft goes back to the default page."}
        confirmLabel="Discard"
        destructive
        onConfirm={() => { setConfirm(null); discard(); }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "publish"}
        title={`${empties.length} ${empties.length === 1 ? "section is" : "sections are"} empty`}
        description={`${empties.map((s) => SECTION_META[s.type].label).join(", ")} won't show on the published page. Publish anyway?`}
        confirmLabel="Publish"
        onConfirm={() => { setConfirm(null); publish(); }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify** — `npm run verify` (PASS).

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/studio
git commit -m "feat(booking-page): sections panel — sortable rows, palette, publish bar, confirm dialogs"
```

---

### Task 15: The builder replaces the studio; page wiring

**Files:**
- Create: `src/features/booking-page/studio/settings-tab.tsx`, `src/features/booking-page/studio/booking-page-builder.tsx`
- Modify: `src/app/(dashboard)/booking-page/page.tsx` (whole file)
- Delete: `src/features/orgs/components/booking-page-studio.tsx`

**Interfaces:**
- Produces: `BookingPageBuilder({ branding, scheduling, appUrl, supabaseUrl, previewServices, staff, initialPage, pageSections })`, `SettingsTab(...)`.
- Consumes: everything above; `listStaff` from `@/features/scheduling/staff-queries` (rows carry `id, name, slug, color, active` — verify with `grep -n "export type StaffRow" -A 12 src/features/scheduling/staff-queries.ts` before writing the mapper); `getPageDraftState`, `getPageSectionsEntitlement` (Tasks 5, 11); `updateWidgetTheme`, `BrandingForm`, `SchedulingSettingsForm` (existing).

- [ ] **Step 1: Settings tab** — the old studio's left column, verbatim behaviour, with `theme` lifted to the builder so the preview follows it:

```tsx
// src/features/booking-page/studio/settings-tab.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { WIDGET_THEME_OPTIONS, type WidgetThemeConfig } from "@/lib/widget-theme";
import { SELECT_CLASS } from "./fields";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Saved-as-you-go settings: address + timezone, logo + accent, and the
   theme (shared with Website embed; saved on change, optimistic with
   rollback — the old studio's changeTheme). */
export function SettingsTab({
  branding, scheduling, appUrl, theme, onTheme, onPreviewAccent, onHandleInput,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string;
  theme: WidgetThemeConfig; onTheme: (next: WidgetThemeConfig) => void;
  onPreviewAccent: (hex: string | null) => void; onHandleInput: (handle: string) => void;
}) {
  const [savingTheme, startSaveTheme] = React.useTransition();
  const changeTheme = (value: WidgetThemeConfig["theme"]) => {
    const previous = theme;
    const next = { ...theme, theme: value };
    onTheme(next);
    startSaveTheme(async () => {
      const result = await updateWidgetTheme(next);
      if (!result.ok) {
        onTheme(previous);
        toast.error(result.error);
      } else toast.success("Theme saved");
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <SchedulingSettingsForm settings={scheduling} appUrl={appUrl} onHandleInput={onHandleInput} />
      <SettingsCard title="Look" description="Saved as you go.">
        <BrandingForm settings={branding} onPreviewAccent={onPreviewAccent} />
        <SettingsRow
          label="Theme"
          htmlFor="bp-theme"
          hint={
            <>
              Shared with the website embed; corner radius, font and colour overrides are on{" "}
              <Link href="/embed" className="hover:text-foreground underline underline-offset-3">Website embed</Link>.
            </>
          }
        >
          <select id="bp-theme" className={SELECT_CLASS} value={theme.theme} disabled={savingTheme} onChange={(e) => changeTheme(e.target.value as WidgetThemeConfig["theme"])}>
            {WIDGET_THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Builder**

```tsx
// src/features/booking-page/studio/booking-page-builder.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import type { PublicService, PublicStaff } from "@/lib/booking/public";
import type { PlanLimits } from "@/lib/billing/plans";
import { effectiveContrast, parseWidgetTheme, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { LivePreview, PreviewNotice, SchemeToggle, type Scheme } from "@/components/live-preview";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { cn } from "@/lib/utils";
import type { PageDocument } from "../schema";
import { replaceSection } from "../doc-ops";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { SelectionProvider } from "../render/selection";
import { usePageDraft } from "./use-page-draft";
import { StudioTabs, type StudioTab } from "./studio-tabs";
import { SectionsPanel } from "./sections-panel";
import { SectionInspector } from "./section-inspector";
import { SettingsTab } from "./settings-tab";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Booking page builder: Sections / Settings on the left, the hosted page as
   a visitor will see it on the right — the same PageRenderer + WidgetTheme
   composition as /book/[handle], fed by the draft and the unsaved settings. */
export function BookingPageBuilder({
  branding, scheduling, appUrl, supabaseUrl, previewServices, staff, initialPage, pageSections,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string; supabaseUrl: string;
  previewServices: PublicService[]; staff: PublicStaff[];
  initialPage: { draft: PageDocument; published: PageDocument | null };
  pageSections: PlanLimits["pageSections"];
}) {
  const draft = usePageDraft(initialPage);
  const [tab, setTab] = React.useState<StudioTab>("sections");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [accent, setAccent] = React.useState<string | null>(branding.accentColor);
  const [handle, setHandle] = React.useState(scheduling.handle ?? "");
  // Only consulted when the widget theme is Auto: the hosted page then follows
  // the visitor's system, which the preview lets you flip.
  const [scheme, setScheme] = React.useState<Scheme>("light");
  const [theme, setTheme] = React.useState<WidgetThemeConfig>(() => parseWidgetTheme(branding.widgetTheme));
  const resolved: Scheme = theme.theme === "auto" ? scheme : theme.theme;
  // Auto resolved to the preview's scheme: `wt-auto` follows the admin's real
  // system (a media query), which the toggle can't flip.
  const previewTheme: WidgetThemeConfig = theme.theme === "auto" ? { ...theme, theme: resolved } : theme;

  const select = React.useCallback((id: string) => {
    setSelectedId(id);
    setTab("sections");
  }, []);
  const selection = React.useMemo(() => ({ selectedId, select }), [selectedId, select]);

  const host = appUrl.replace(/^https?:\/\//, "");
  const previewHandle = handle.trim() || "your-handle";
  const url = `${host}/book/${previewHandle}`;
  const ctx: RenderContext = {
    org: { orgId: branding.orgId, orgName: branding.orgName, handle: previewHandle, timeZone: scheduling.timezone },
    branding: { accentColor: accent, logoUrl: branding.logoUrl },
    theme: previewTheme,
    services: previewServices, staff, offerings: [], lockedStaff: null,
    supabaseUrl, mode: "preview", previewSlots: PREVIEW_SLOTS,
  };
  const selected = draft.doc.sections.find((s) => s.id === selectedId) ?? null;

  // Colour overrides (set on Website embed) apply here too — surface a weak
  // pair the same way the embed page does, so it isn't missed on this page.
  const overrideRatio = theme.background || theme.text ? effectiveContrast(theme) : null;
  const embedRisk = !theme.background && theme.theme !== "auto";
  const oppositeScheme: Scheme = theme.theme === "light" ? "dark" : "light";
  const oppositeLabel = theme.theme === "light" ? "Dark" : "Light";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <StudioTabs value={tab} onChange={setTab} />
        {tab === "settings" ? (
          <SettingsTab branding={branding} scheduling={scheduling} appUrl={appUrl} theme={theme} onTheme={setTheme} onPreviewAccent={setAccent} onHandleInput={setHandle} />
        ) : selected ? (
          <SectionInspector
            section={selected}
            issues={draft.issues[selected.id] ?? {}}
            supabaseUrl={supabaseUrl}
            onChange={(next) => draft.update((d) => replaceSection(d, next))}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <SectionsPanel
            draft={draft}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyContext={{ serviceCount: previewServices.length, staffCount: staff.length }}
            liveUrl={scheduling.handle ? `${appUrl}/book/${scheduling.handle}` : null}
            pageSections={pageSections}
            templatePicker={null}
          />
        )}
      </div>

      <div className="lg:sticky lg:top-[calc(52px+1.5rem)] lg:self-start">
        <LivePreview
          url={url}
          dark={resolved === "dark"}
          // Same shell as /book/[handle], resolved for the preview: scoping
          // .light/.dark here keeps it faithful whatever the admin's theme is.
          pageClassName={cn(resolved, "bg-background text-foreground")}
          desktopMaxWidth={pageContainerClass(draft.doc.layout)}
          controls={
            <SchemeToggle
              label="Visitor's system theme"
              value={resolved}
              onChange={setScheme}
              optionLabels={{ light: "Light system", dark: "Dark system" }}
              disabled={theme.theme !== "auto"}
              disabledReason={`Theme is fixed to ${theme.theme === "light" ? "Light" : "Dark"} — every visitor sees this. Set Theme to Auto to preview both.`}
            />
          }
          notices={
            overrideRatio !== null && overrideRatio < 4.5 ? (
              <PreviewNotice tone={overrideRatio < 3 ? "error" : "warn"}>
                The widget&apos;s colour overrides give {overrideRatio.toFixed(1)}:1 contrast
                {overrideRatio < 3 ? " — unreadable" : " — below 4.5:1 (AA body text)"}. Adjust them on{" "}
                <Link href="/embed" className="underline underline-offset-3">Website embed</Link>.
              </PreviewNotice>
            ) : embedRisk ? (
              <PreviewNotice tone="warn">
                This page is always readable — it paints its own {theme.theme} ground. But Theme is shared with the
                website embed, which takes your site&apos;s surface: on a {oppositeScheme} site its text becomes
                unreadable. If your site is {oppositeScheme}, choose {oppositeLabel} (or Auto), or set a background
                colour on <Link href="/embed" className="underline underline-offset-3">Website embed</Link>.
              </PreviewNotice>
            ) : theme.theme === "auto" ? (
              <PreviewNotice tone="info">
                Auto follows each visitor&apos;s system setting. This page always matches, so both variants are
                readable (use the toggle above). The website embed only matches if your site does too — check it there.
              </PreviewNotice>
            ) : null
          }
        >
          <SelectionProvider value={selection}>
            <WidgetTheme config={previewTheme} accentColor={accent} transparent className="flex flex-col">
              <PageRenderer doc={draft.doc} ctx={ctx} />
            </WidgetTheme>
          </SelectionProvider>
        </LivePreview>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Page wiring** — rewrite `src/app/(dashboard)/booking-page/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import { getPageDraftState, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.) */
export default async function BookingPagePage() {
  const [branding, scheduling, services, staff] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
  ]);
  if (!branding || !scheduling) notFound();
  const [page, pageSections] = await Promise.all([
    getPageDraftState(branding.orgId),
    getPageSectionsEntitlement(branding.orgId),
  ]);

  return (
    // Wider than the other settings pages: the preview must be able to show
    // the split layout (≥ 48rem of page column) at desktop.
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Arrange its sections, brand it, then publish.</PageIntro>
      <BookingPageBuilder
        branding={branding}
        scheduling={scheduling}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
        previewServices={toPreviewServices(services)}
        // The preview's Team section shows the real active roster (public shape: never email).
        staff={staff.filter((s) => s.active).map(({ id, name, slug, color }) => ({ id, name, slug, color }))}
        initialPage={{ draft: page.draft, published: page.published }}
        pageSections={pageSections}
      />
    </div>
  );
}
```

- [ ] **Step 4: Delete the old studio** — `git rm src/features/orgs/components/booking-page-studio.tsx`. Grep for remaining imports of `BookingPageStudio` (there should be none besides the page you just rewrote).

- [ ] **Step 5: Verify + smoke** — `npm run verify` (PASS). `npm run dev`, open `/booking-page`:
  - Sections tab shows Header + Booking (Required), "Not published yet", the default-page hint.
  - Add Cover → inspector opens; type a headline → preview updates instantly; status goes Saving… → Saved within ~1 s; reload: the draft is back.
  - Drag Cover above Header (mouse) and with the keyboard (focus handle, Space, arrows, Space).
  - Hide/show, remove; Booking row has neither control.
  - Put `http://x` in a Links item → "Fix errors to save", red badge on the row, inline message; Publish disabled.
  - Publish → toast, badge "Live"; `/book/<handle>` shows the cover; edit again → "Unpublished changes"; Discard → back to the published page.
  - Settings tab: handle, logo, accent, theme still work and the preview follows.
  - Split layout: preview docks Booking on the right at desktop, stacks on Mobile.

- [ ] **Step 6: Commit**

```bash
git add -A src/features/booking-page/studio "src/app/(dashboard)/booking-page/page.tsx" src/features/orgs/components/booking-page-studio.tsx
git commit -m "feat(booking-page): the builder replaces the studio — sections, inspector, settings tab, live preview"
```

---

### Task 16: Templates, the picker dialog, skin apply

**Files:**
- Create: `src/features/booking-page/templates.ts`, `src/features/booking-page/studio/template-picker.tsx`
- Modify: `src/features/booking-page/studio/booking-page-builder.tsx` (pass the picker; apply skin)
- Test: `src/features/booking-page/templates.test.ts`

**Interfaces:**
- Produces: `Template`, `TemplateSkin`, `TEMPLATES` (six), `stripSample(section)`, `applyTemplate(t): PageDocument`, `templatePreview(t): PageDocument`; `TemplatePicker({ doc, ctx, onApply })` where `onApply(doc, skin | null)`.
- Consumes: `newSection`, `newSectionId` (Task 2), `deepEqual`, `DEFAULT_PAGE` (Tasks 2–3), `PageRenderer`, `pageContainerClass`, `WidgetTheme`, `updateWidgetTheme`, `ConfirmDialog` (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/booking-page/templates.test.ts
import { describe, it, expect } from "vitest";
import { TEMPLATES, applyTemplate, templatePreview, stripSample } from "./templates";
import { pageDocumentSchema } from "./schema";
import { imagePathsIn } from "./images";
import { isSectionEmpty } from "./doc-ops";

describe("templates", () => {
  it("ships six, each a valid preview document and a valid applied document", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["classic", "profile", "studio", "split", "team", "minimal"]);
    for (const t of TEMPLATES) {
      expect(pageDocumentSchema.safeParse(templatePreview(t)).success, `${t.id} preview`).toBe(true);
      const applied = applyTemplate(t);
      expect(pageDocumentSchema.safeParse(applied).success, `${t.id} applied`).toBe(true);
      expect(applied.layout).toBe(t.layout);
      expect(applied.sections.map((s) => s.type)).toEqual(t.sections.map((s) => s.type));
    }
  });
  it("applyTemplate strips sample copy and images, assigns fresh ids, keeps live-section titles", () => {
    const ctx = { serviceCount: 1, staffCount: 1 };
    for (const t of TEMPLATES) {
      const applied = applyTemplate(t);
      expect(imagePathsIn(applied)).toEqual([]);
      for (const s of applied.sections) {
        expect(t.sections.some((o) => o.id === s.id), `${t.id} reuses id ${s.id}`).toBe(false);
        if (s.type !== "header" && s.type !== "booking" && s.type !== "services" && s.type !== "staff") {
          expect(isSectionEmpty(s, ctx), `${t.id}/${s.type} not stripped`).toBe(true);
        }
        if (s.type === "services") expect(s.title).toBe("Services");
      }
    }
  });
  it("stripSample keeps list shapes (an empty row per sample item) and link icons", () => {
    const studio = TEMPLATES.find((t) => t.id === "studio")!;
    const quotes = studio.sections.find((s) => s.type === "testimonials")!;
    const stripped = stripSample(quotes);
    expect(stripped.type === "testimonials" && stripped.items.every((i) => i.quote === "" && i.author === "")).toBe(true);
    const profile = TEMPLATES.find((t) => t.id === "profile")!;
    const links = profile.sections.find((s) => s.type === "links")!;
    const strippedLinks = stripSample(links);
    expect(strippedLinks.type === "links" && strippedLinks.items.map((i) => i.icon)).toEqual(links.type === "links" ? links.items.map((i) => i.icon) : []);
  });
  it("classic is the default page shape, applied", () => {
    expect(applyTemplate(TEMPLATES[0]!).sections.map((s) => s.type)).toEqual(["header", "booking"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/booking-page/templates.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `templates.ts`**

```ts
// src/features/booking-page/templates.ts
// Starter compositions. Section text here is SAMPLE COPY for the picker's
// live thumbnails; applyTemplate strips it so nobody publishes "Hair & colour
// by Anna" by accident. Thumbnails never carry images (no storage paths to
// maintain) — the ghost boxes read fine at thumbnail scale.
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { newSection, newSectionId } from "./defaults";
import type { PageDocument, Section, SectionOf, SectionType } from "./schema";

export type TemplateSkin = Pick<WidgetThemeConfig, "theme" | "radius" | "font">;
export type Template = {
  id: string;
  name: string;
  description: string;
  layout: PageDocument["layout"];
  sections: Section[];
  skin?: TemplateSkin;
};

function s<T extends SectionType>(type: T, id: string, props: Partial<Omit<SectionOf<T>, "id" | "type" | "hidden">> = {}): Section {
  return { ...newSection(type, id), ...props } as Section;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Your name and the booking widget. Today's page.",
    layout: "column",
    sections: [s("header", "tplhdr001"), s("booking", "tplbook01")],
  },
  {
    id: "profile",
    name: "Profile",
    description: "A link-in-bio page: who you are, what you offer, where to find you.",
    layout: "column",
    sections: [
      s("header", "tplhdr002", { tagline: "Colour specialist · Kraków" }),
      s("about", "tplabt002", { title: "Hi, I'm Anna", body: "Fifteen years of colour, cuts and calm. Book a time below — first visits include a free consultation." }),
      s("services", "tplsvc002", { style: "list" }),
      s("links", "tpllnk002", { items: [
        { label: "Instagram", url: "https://instagram.com/anna.hair", icon: "instagram" },
        { label: "WhatsApp", url: "https://wa.me/48600000000", icon: "whatsapp" },
      ] }),
      s("booking", "tplbook02", { title: "Book a time" }),
    ],
    skin: { theme: "light", radius: "round", font: "lora" },
  },
  {
    id: "studio",
    name: "Studio",
    description: "Cover, service cards with prices, gallery and testimonials.",
    layout: "column",
    sections: [
      s("hero", "tplhero03", { headline: "Hair & colour by Anna", subheadline: "A small studio in Kazimierz. Balayage, precision cuts, colour correction.", align: "center" }),
      s("services", "tplsvc003", { style: "cards" }),
      s("gallery", "tplgal003", { columns: 3 }),
      s("testimonials", "tpltst003", { items: [
        { quote: "The only person I trust with my colour.", author: "Marta K." },
        { quote: "Booked in two taps, walked out glowing.", author: "Ola W." },
      ] }),
      s("booking", "tplbook03", { title: "Book a time" }),
      s("location", "tplloc003", { address: "ul. Józefa 12\n31-056 Kraków", mapsUrl: "https://maps.app.goo.gl/example" }),
    ],
    skin: { theme: "dark", radius: "subtle", font: "space-grotesk" },
  },
  {
    id: "split",
    name: "Split",
    description: "Story on the left, booking pinned on the right.",
    layout: "split",
    sections: [
      s("hero", "tplhero04", { headline: "Physiotherapy that gets you moving", subheadline: "One-to-one sessions, no waiting room." }),
      s("about", "tplabt004", { title: "About the practice", body: "Sports rehab, posture and pain management.\n\nEvery plan starts with a full assessment." }),
      s("services", "tplsvc004", { style: "list" }),
      s("faq", "tplfaq004", { items: [
        { q: "Do I need a referral?", a: "No — book directly." },
        { q: "What should I bring?", a: "Comfortable clothes and any recent scans." },
      ] }),
      s("location", "tplloc004", { address: "Aleja Pokoju 5\n31-548 Kraków" }),
      s("booking", "tplbook04", { title: "Book a session" }),
    ],
    skin: { theme: "light", radius: "subtle", font: "dm-sans" },
  },
  {
    id: "team",
    name: "Team",
    description: "Your people first, then services and booking.",
    layout: "column",
    sections: [
      s("header", "tplhdr005", { tagline: "Barbers since 2015" }),
      s("staff", "tplstf005", { title: "Pick your barber" }),
      s("services", "tplsvc005", { style: "list" }),
      s("booking", "tplbook05", { title: "Book a chair" }),
      s("location", "tplloc005", { address: "ul. Długa 3\n31-147 Kraków" }),
    ],
    skin: { theme: "light", radius: "subtle", font: "inter" },
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "A headline, the widget, your links. Nothing else.",
    layout: "column",
    sections: [
      s("hero", "tplhero06", { headline: "Book a tutoring session", subheadline: "Maths & physics, online or in Kraków.", align: "center" }),
      s("booking", "tplbook06"),
      s("links", "tpllnk006", { items: [{ label: "Email me", url: "mailto:hello@example.com", icon: "email" }] }),
    ],
    skin: { theme: "light", radius: "none", font: "system" },
  },
];

/** Fresh id, sample copy gone, list shapes kept (one empty row per sample
    item), live-section titles kept — they are labels, not sample copy. */
export function stripSample(section: Section): Section {
  const base = { ...section, id: newSectionId() } as Section;
  switch (base.type) {
    case "header": return { ...base, tagline: "" };
    case "hero": {
      const next = { ...base, headline: "", subheadline: "" };
      delete next.imagePath;
      return next;
    }
    case "about": {
      const next = { ...base, title: "", body: "" };
      delete next.photoPath;
      return next;
    }
    case "gallery": return { ...base, images: [] };
    case "testimonials": return { ...base, items: base.items.map(() => ({ quote: "", author: "" })) };
    case "faq": return { ...base, items: base.items.map(() => ({ q: "", a: "" })) };
    case "links": return { ...base, items: base.items.map((i) => ({ label: "", url: "", icon: i.icon })) };
    case "location": return { ...base, address: "", mapsUrl: "" };
    case "services":
    case "staff":
    case "booking":
      return base;
  }
}

export function applyTemplate(t: Template): PageDocument {
  return { version: 1, layout: t.layout, sections: t.sections.map(stripSample) };
}

/** The thumbnail document: sample copy intact. */
export function templatePreview(t: Template): PageDocument {
  return { version: 1, layout: t.layout, sections: t.sections };
}
```

- [ ] **Step 4: Run the test** — `npx vitest run src/features/booking-page/templates.test.ts`. Expected: PASS.

- [ ] **Step 5: Picker dialog**

```tsx
// src/features/booking-page/studio/template-picker.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WidgetTheme } from "@/components/widget-theme";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { cn } from "@/lib/utils";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { TEMPLATES, applyTemplate, templatePreview, type Template, type TemplateSkin } from "../templates";
import { ConfirmDialog } from "./confirm-dialog";

/* Live thumbnails: the real PageRenderer, scaled, with the org's own
   name/logo/services and the template's sample copy. `inert` keeps the
   widget inside from taking focus or clicks. */
function TemplateThumb({ template, ctx }: { template: Template; ctx: RenderContext }) {
  const base: WidgetThemeConfig = template.skin ? { ...ctx.theme, ...template.skin, background: undefined, text: undefined } : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-md border" aria-hidden inert>
      <div className={cn("pointer-events-none absolute top-0 left-0 w-[900px] origin-top-left scale-[0.3] p-8", scheme, "bg-background text-foreground")}>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            <PageRenderer doc={templatePreview(template)} ctx={{ ...ctx, theme, mode: "preview" }} />
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

export function TemplatePicker({
  doc, ctx, onApply,
}: {
  doc: PageDocument; ctx: RenderContext;
  onApply: (next: PageDocument, skin: TemplateSkin | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [applySkin, setApplySkin] = React.useState(true);
  const [pending, setPending] = React.useState<Template | null>(null);
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const commit = (t: Template) => {
    onApply(applyTemplate(t), applySkin && t.skin ? t.skin : null);
    setPending(null);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm">Start from a template</Button>} />
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
            <DialogDescription>Pick a starting point, then make it yours. Your published page stays until you publish.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={applySkin} onCheckedChange={(c) => setApplySkin(c === true)} />
            Also apply the template&apos;s look (theme, font, corners)
          </label>
          <ul className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => (dirty ? setPending(t) : commit(t))}
                  className="hover:border-primary focus-visible:ring-ring/50 flex w-full flex-col gap-2 rounded-lg border p-2 text-left outline-none focus-visible:ring-2"
                >
                  <TemplateThumb template={t} ctx={ctx} />
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-muted-foreground text-xs">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        title="Replace your current draft?"
        description="Your published page stays until you publish."
        confirmLabel="Replace"
        onConfirm={() => pending && commit(pending)}
        onClose={() => setPending(null)}
      />
    </>
  );
}
```

- [ ] **Step 6: Wire into the builder** — in `booking-page-builder.tsx`:

```tsx
import { toast } from "sonner";
import { updateWidgetTheme } from "@/features/orgs/actions";
import type { TemplateSkin } from "../templates";
import { TemplatePicker } from "./template-picker";
```

inside the component, after `selection`:

```tsx
  const [, startSaveSkin] = React.useTransition();
  const applySkin = (skin: TemplateSkin) => {
    // Theme/radius/font from the template; accent, logo and the badge setting
    // are the org's own; bg/text overrides cleared so the skin reads as designed.
    const previous = theme;
    const next: WidgetThemeConfig = { ...theme, ...skin, background: undefined, text: undefined };
    setTheme(next);
    startSaveSkin(async () => {
      const result = await updateWidgetTheme(next);
      if (!result.ok) {
        setTheme(previous);
        toast.error("Template applied, but the look couldn't be saved.");
      }
    });
  };
  const onApplyTemplate = (next: PageDocument, skin: TemplateSkin | null) => {
    draft.update(next);
    setSelectedId(null);
    if (skin) applySkin(skin);
    toast.success("Template applied");
  };
```

and replace `templatePicker={null}` with:

```tsx
            templatePicker={<TemplatePicker doc={draft.doc} ctx={ctx} onApply={onApplyTemplate} />}
```

- [ ] **Step 7: Verify + smoke** — `npm run verify` (PASS). In the studio: open the picker — six thumbnails render with your org name and services; pick Studio with the look box on → draft replaced by empty sections with ghost placeholders, theme switches to dark/Space Grotesk in the preview and on reload; pick again → "Replace your current draft?" confirm. Publish → the public page shows the new composition.

- [ ] **Step 8: Commit**

```bash
git add src/features/booking-page/templates.ts src/features/booking-page/templates.test.ts src/features/booking-page/studio/template-picker.tsx src/features/booking-page/studio/booking-page-builder.tsx
git commit -m "feat(booking-page): six starter templates with live thumbnails and optional skin"
```

---

### Task 17: Manual QA, graph update, notes

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-booking-page-builder-design.md` (status line only, if anything diverged), `graphify-out/` (regenerated)

- [ ] **Step 1: Manual browser checklist** (Playwright MCP or a real browser, local stack):
  1. Fresh org (no row): `/booking-page` shows the default page; `/book/<handle>` is pixel-identical to before the feature.
  2. Pick **Studio** → fill hero headline, upload a PNG cover, add two gallery photos, a quote, publish → `/book/<handle>` shows it; `<title>` is the org name, `<meta name="description">` is the headline, `og:image` is the cover URL.
  3. Upload an SVG renamed `.png` → rejected with "Use a PNG, JPEG or WebP image under 5 MB."; a 6 MB JPEG → rejected client-side.
  4. Remove a gallery photo, publish → the object is gone from `branding/<orgId>/page/` (Supabase Studio → Storage).
  5. Services section: click a service → widget scrolls into view with that service selected; `/book/<handle>?service=<uuid>` preselects; an unknown uuid is ignored.
  6. Team org: staff section shows ≥2 people; clicking one opens `/book/<handle>/<slug>`, which inherits the page **without** the staff section and shows "Booking with X".
  7. Split layout: docked booking at ≥ 48 rem of page column (desktop), stacked on the preview's Mobile toggle and on a real phone width.
  8. Dark skin (Studio template) on the public page, then Auto with the scheme toggle.
  9. Hidden section never appears publicly; ghost placeholders never appear publicly (view source of `/book/<handle>`: no "Add a headline").
  10. Keyboard: Tab to a row's grip, Space, ↑/↓, Space → order changes and saves; Tab into the preview, Enter on a section → inspector opens.
  11. Contrast notices on the preview still show when Website embed has overrides.
  12. `/embed/<handle>` unchanged.
  13. Two tabs editing: last write wins, no error.

- [ ] **Step 2: Full test run** — `npm run verify` and `npm run test:integration` both PASS.

- [ ] **Step 3: Graph + notes** — `graphify update .`; if anything above diverged from the spec, edit the spec in place (it is the design of record). Commit:

```bash
git add graphify-out docs/superpowers/specs/2026-08-23-booking-page-builder-design.md
git commit -m "chore(booking-page): graph update and spec notes after QA"
```

- [ ] **Step 4: Open the PR** (`gh pr create`) titled `feat(booking-page): builder — templates + typed sections, draft/publish, studio editor`, body: the spec path, the migration numbers (0047/0048; R3 renumbers from 0049), the manual checklist results, and the deliberate no-gating note (`pageSections` wired, all plans "all").

## Self-review (done while writing)

- **Spec coverage:** data model + RPCs (Tasks 2, 4, 5); document/section catalogue + limits (2); parse fallback (5); renderer contract, `WidgetTheme` wrap, split layout, staff pages, services→booking hand-off, `?service=`, metadata, failure modes (6–9); studio tabs, draft lifecycle, sections list, palette, layout control, inspector, preview interaction, errors (12–15); templates, thumbnails, strip, skin apply, replace-confirm, empty-publish warning (14, 16); media path/validation/caps/orphans (1, 10); gating key + palette tag + publish check (11); tests per spec (1–6, 11, 16); out-of-scope untouched.
- **Deviations from the spec, already written back into it:** controlled inputs instead of react-hook-form; image path `{orgId}/page/…`; container-query breakpoint `@3xl`; page-level `WidgetTheme` always transparent with the booking section nesting its own; `uploadPageImage` returns `{ ok, path }`.
- **Type consistency:** `replaceSection(doc, next)` is the only section-update primitive (forms return whole sections via `patch`); `EmptyContext = { serviceCount, staffCount }` everywhere; `RenderContext` carries `supabaseUrl` (not a function); `requestedService: { id, key }` on the widget and `usePageState().requested`; `PageDraft = ReturnType<typeof usePageDraft>` is what `SectionsPanel` takes; error copy constants live in `schema.ts`.
