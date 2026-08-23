# Booking Page Builder — Templates + Sections — Design

**Date:** 2026-08-23
**Status:** Approved
**Branch:** `feat/booking-page-builder`
**Context:** Scheduling pivot roadmap `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md`; builds on S3 (`2026-08-16-scheduling-s3-widget-embed-design.md`), which introduced the CSS-variable theme layer and the Booking page studio.

## Goal

Let a provider turn the hosted booking page into *their* page — bio, photos, services showcase, links, location — by picking a template and arranging typed sections, so the page can stand in for a website (many solo providers have none). Today `/book/[handle]` is one fixed composition (header + widget) with token-level theming only.

## Scope decisions (user-confirmed)

- **Page's job:** the provider's whole web presence, staged — v1 ships templates + section editing on a data shape that already is a constructor.
- **Model: ordered list of typed sections** (approach 1), not a free canvas and not a layout enum. Free positioning was rejected: it does not map to mobile (where most bookings happen), the editor costs 3–5× more, and non-designers produce worse pages with it. A section stack is responsive by construction and templates fall out of it for free.
- **Editor depth:** reorder + add/remove + per-section forms, click-to-select in the live preview. No inline text editing, no per-section style overrides.
- **Draft + Publish**, not saved-as-you-go: edits autosave to a draft; the public page shows the last published document.
- **Theme stays where it is** (`orgs.widget_theme`, accent, logo). The page document decides *what* is on the page; the skin decides how it looks. Templates may *apply* a skin on pick.
- **Embed untouched**: `/embed/[handle]` remains widget-only.
- **Catalogue**: all eleven section types below ship in v1 (user chose to keep `staff` and `testimonials`).

## Data model

### Table `booking_pages` (migration 0047, Drizzle; 0048 `_booking_page_security.sql` for RLS, grants, RPCs)

```
org_id        uuid primary key references orgs(id) on delete cascade
draft         jsonb not null
published     jsonb                      -- null = never published
published_at  timestamptz
updated_at    timestamptz not null default now()
```

- Explicit `GRANT`s (repo convention: newer Supabase images drop default ACLs).
- RLS: `select` for org members (same membership predicate as `orgs`). No insert/update/delete policies — writes go only through definer RPCs.
- No row, or `published is null` → the public page renders the **default composition** (exactly today's page). Existing orgs need no backfill; nothing changes for them until they publish.

### RPCs (security definer, `authenticated` may execute, idiom of `update_org_widget_theme(uuid, jsonb)` in 0033)

| RPC | Checks | Effect |
|---|---|---|
| `save_booking_page_draft(p_org_id uuid, p_doc jsonb)` | membership; `pg_column_size(p_doc) <= 65536`; `p_doc->>'version' = '1'`; exactly one element of `p_doc->'sections'` has `type = 'booking'` | upsert `draft`, bump `updated_at` |
| `publish_booking_page(p_org_id uuid)` | membership; row exists | `published := draft`, `published_at := now()`. The `publishBookingPage(doc)` server action always calls `save_booking_page_draft` first, so publishing never depends on a row already existing (an org that never edited can publish the default page) |
| `discard_booking_page_draft(p_org_id uuid, p_fallback jsonb)` | membership; row exists | `draft := coalesce(published, p_fallback)` — the server action passes `DEFAULT_PAGE` as `p_fallback` so SQL does not duplicate the default composition |

The RPC layer enforces only what is cheap in SQL. Full shape validation is zod in the server action. An org member could still call an RPC directly with junk that passes the SQL checks, so **the public renderer never trusts jsonb**: it `safeParse`s and falls back to the default composition (see Public rendering).

### Document

```ts
type PageDocument = {
  version: 1;
  layout: "column" | "split";
  sections: Section[];            // 1..20
};
type SectionBase = { id: string /* ^[a-z0-9]{6,12}$ */; hidden: boolean };
```

- `column` = today's single `max-w-lg` stack. `split` = at `lg+` the booking section docks sticky in a right column and the rest flows left; on narrower viewports the page stacks in array order.
- Exactly one `booking` section; it cannot be hidden or deleted.
- Single-instance types: `header`, `booking`, `services`, `staff`. All others may repeat.
- Images are **storage paths**, not URLs (`{orgId}/page/{sha256:16}.{ext}` in the `branding` bucket — same `{orgId}/` prefix discipline as `logoPathFor`), validated against the org's own prefix; resolved to public URLs at render with a pure helper (`pageImageUrl(supabaseUrl, path)`), never the admin client, so the client-side studio preview resolves them identically.
- All text is plain text. No markdown, no HTML, no URLs in text fields beyond the `links`/`location` fields defined below. Optional text props (`title?`, `tagline?`, …) are stored as empty strings, never omitted; `imagePath?`/`photoPath?` are omitted when unset. `links`/`location` URLs may be empty while a draft is incomplete — an item with an empty `label` or `url` renders nothing.

### Section catalogue (v1)

| `type` | props | data source / notes |
|---|---|---|
| `header` | `tagline?` (≤120) | logo, name, accent from org (today's `BrandedHeader`) |
| `hero` | `imagePath?`, `headline` (≤80), `subheadline?` (≤160), `align: "left" \| "center"` | — |
| `about` | `title?` (≤60), `body` (≤2000, `\n\n` paragraphs), `photoPath?` | — |
| `services` | `title?`, `style: "list" \| "cards"`, `showPrices`, `showDurations` | **live** public services (already plan-narrowed); click → booking section with that service preselected |
| `staff` | `title?` | **live** roster; renders nothing unless ≥2 active bookable staff; click → per-staff page |
| `gallery` | `images: { path, alt? (≤120) }[]` ≤12, `columns: 2 \| 3` | — |
| `testimonials` | `items: { quote (≤300), author (≤60) }[]` ≤6 | — |
| `faq` | `items: { q (≤120), a (≤600) }[]` ≤10 | — |
| `links` | `items: { label (≤40), url, icon }[]` ≤8; `icon ∈ instagram, facebook, tiktok, whatsapp, website, phone, email, other` | `url` must be `https:` — except `tel:` when `icon = phone` and `mailto:` when `icon = email` |
| `location` | `address` (≤300, lines), `mapsUrl?` (`https:` only) | no embedded map |
| `booking` | `title?` (≤60) | the widget; exactly one |

Page-wide limits: ≤20 sections, ≤24 image references, ≤64 KB serialized.

"Empty" section = every text/image prop empty. The live-data sections have their own rule: `staff` renders nothing with fewer than two bookable staff; `services` always has data (a page with no services is a 404). Empty or `hidden` sections render nothing on the public page.

### Zod

`src/features/booking-page/schema.ts` exports: per-type section schemas, `sectionSchema` (discriminated union on `type`), `pageDocumentSchema` (with the cross-field refinements: exactly one booking, single-instance rule, section and image caps), and `parsePageDocument(raw: unknown): PageDocument | null`.

## Public rendering

### Module

```
src/features/booking-page/
  schema.ts            zod + parsePageDocument
  defaults.ts          DEFAULT_PAGE (header + booking, column)
  templates.ts         TEMPLATES, applyTemplate()
  queries.ts           getPublishedPage(orgId) (admin client), getPageDraft() (session)
  actions.ts           saveBookingPageDraft, publishBookingPage, discardBookingPageDraft, uploadPageImage
  images.ts            path builder/validator, orphan diff (pure)
  metadata.ts          pageMetadata(doc, org) (pure)
  render/
    page-renderer.tsx  PageRenderer({ doc, ctx })
    page-state.tsx     PageStateProvider / usePageState (client)
    sections/<type>.tsx
  studio/              (see Studio editor)
```

### Renderer contract

`PageRenderer({ doc, ctx })` maps `doc.sections` to section components in order and handles `layout`. Sections are pure functions of their props plus `ctx`:

```ts
type RenderContext = {
  org: { orgId; orgName; handle; timeZone };
  branding: { accentColor; logoUrl };
  theme: WidgetThemeConfig;          // the booking section nests its own WidgetTheme with it
  services: PublicService[]; staff: PublicStaff[]; serviceStaffIds?; offerings;
  lockedStaff: PublicStaff | null;   // staff pages
  supabaseUrl: string;               // images resolve via the pure pageImageUrl(supabaseUrl, path)
  mode: "public" | "preview";
  previewSlots?: string[];           // studio passes PREVIEW_SLOTS
};
```
Plain data only — no functions — because it crosses the server → client boundary into the client-side sections.

The same renderer serves `/book/[handle]`, `/book/[handle]/[staffSlug]`, the studio preview, and the template thumbnails. Only `doc` and `mode` differ.

### `/book/[handle]`

- Adds one fetch, `getPublishedPage(org.orgId)` via the admin client (idiom of `getBookingOrg`), selecting only `published`. `parsePageDocument(published) ?? DEFAULT_PAGE`.
- Existing not-found rules (handle regex, unknown org, no services and no offerings) are unchanged.
- **`WidgetTheme` additionally wraps the whole `<main>`** (always `transparent`) so font, radius, accent, text and line tokens reach every section; the booking section nests its own `WidgetTheme` with `transparent={!theme.background}` so a background override still paints the widget card exactly as today and nothing else. The `bookShellClass(theme.theme)` shell is unchanged. `ctx.theme` carries the parsed config for that.
- `layout: "split"` → container `max-w-5xl`; the renderer root is a Tailwind v4 `@container` and the split grid engages at `@3xl` (48 rem of *container* width, not viewport), so the studio preview and its phone toggle behave exactly like the real page. Booking section: `@3xl:col-start-2 @3xl:row-start-1 @3xl:row-end-[-1] @3xl:sticky @3xl:top-6 @3xl:self-start` with explicit `grid-template-rows: repeat(n, auto)` (n = other visible sections) so the span covers every row without phantom gap rows. DOM order stays the array order.
- Hero spans the container width, never the viewport.
- `PoweredBy` stays last, same `badgeVisible` rule.

### Staff pages

`/book/[handle]/[staffSlug]` renders the org's published page with the `staff` section filtered out and `ctx.lockedStaff` set, which the booking section passes to the widget as today. No separate document.

### Services → booking hand-off

`PageStateProvider` (client) wraps the rendered sections with `{ requested: { id, key } | null, selectService(id) }` — every request carries an incrementing key so re-picking the same service after "change" still lands. A service card calls `selectService(id)` and scrolls the booking section into view (`id="book"`); `BookingWidget` gains a `requestedService` prop fed from the context and applies it during render (no effect). `?service=<id>` on the URL seeds the provider (pairs with the existing `?staff=`); `resolveInitialService` (pure) accepts only a uuid naming a listed service. Unknown ids are ignored.

### Metadata

`generateMetadata` (both public routes) uses `pageMetadata(doc, org)`: `title` = org name; `description` = first present of hero headline, header tagline, first line of about, else today's default; `openGraph.images` = hero image URL if set, else omitted.

### Failure modes

- `published` fails to parse → `DEFAULT_PAGE`, `console.error` with the org id. Never a blank or broken page.
- Image path outside the org's prefix (fails schema) → the whole doc fails parse → default composition. A deleted storage object simply 404s in the `<img>`; no existence checks at render.

## Studio editor

### Where

Configure → Booking page (`/booking-page`, `BookingPageStudio`). The left panel gets two tabs (a hand-rolled `role="tablist"` strip in local state — there is no Tabs primitive in `ui/`):

- **Sections** — the builder (draft → Publish).
- **Settings** — today's scheduling settings form and Look card, still saved as you go.

The right column stays the sticky `LivePreview`, rendering `PageRenderer` with the draft in `mode: "preview"`. The existing `SchemeToggle`, contrast notices and URL bar stay on the preview.

### Draft lifecycle

- Load: server component fetches `draft` (or `DEFAULT_PAGE` if no row) and whether `draft` deep-equals `published`.
- Edits mutate local state first (preview updates instantly), then autosave debounced ~800 ms via `saveBookingPageDraft(doc)`. Autosave runs `pageDocumentSchema` first; if invalid it shows *Fix errors to save* and does not call the action — the RPC only ever receives valid documents from the app.
- Status pill: *Saving… / Saved / Couldn't save — retry* (retry re-sends the current local doc).
- Bar above the list: **Unpublished changes** badge (client deep-equal draft vs last-known published), **Publish**, **Discard changes** (confirm dialog: reverts to published, or to `DEFAULT_PAGE` if never published). Publish sends the current local doc (`publishBookingPage(doc)` saves, then publishes — no dependence on a pending autosave or an existing row), warns if visible sections are empty ("2 sections are empty and won't show") and proceeds on confirm.
- Concurrency: two tabs editing the same page — last write wins, no versioning in v1.
- "View live page" opens `/book/<handle>` in a new tab.

### Sections list

- Row: drag handle, type icon, type label, summary line (hero headline, "4 images", "3 questions"…), visibility toggle, delete. The `booking` row is marked *required* — no delete, no hide.
- Reorder with `@dnd-kit/sortable` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — new dependencies) with `PointerSensor` + `KeyboardSensor` and the sortable keyboard coordinates for a11y; dnd-kit's built-in screen-reader announcements.
- **Add section**: popover palette of the ten addable types with one-line descriptions; single-instance types already present are disabled with "Already on the page"; at 20 sections the button is disabled with a hint. New sections insert after the selected section (else at the end) with type defaults and open the inspector.
- **Layout** segmented control (Column / Split) at the top; drives `doc.layout` and the preview's `desktopMaxWidth`.
- **Start from a template** button next to it (see Templates).
- First visit (no row): one-line hint above the list — "This is the default page. Pick a template or add sections."

### Inspector

Selecting a section (from the list or by clicking it in the preview) drills the left panel into its form, with **← Sections** to return. One form per type under `studio/forms/<type>.tsx`, controlled inputs writing straight into the document (the repo idiom — react-hook-form is installed but unused anywhere); the whole document is validated with `pageDocumentSchema` before every autosave and zod issues are mapped back to the owning section's fields, shown inline. List props (gallery images, FAQ, testimonials, links) use inline add / remove / move up / move down — no nested drag-and-drop. Image fields use an upload control modelled on the logo upload (`uploadPageImage` → `{ path }`), showing a thumbnail and a remove button.

### Preview interaction

In `mode: "preview"` each section wrapper carries `data-section-id`, a hover outline, and a click handler that selects the section; the selected section keeps an accent outline and a small type chip. Selecting from the list scrolls the preview wrapper into view. Empty text/image props render ghost placeholders ("Add a headline", dashed image box) in preview only. Links and service cards do not navigate in preview.

## Templates and skins

`templates.ts`:

```ts
type Template = {
  id: string; name: string; description: string;
  layout: PageDocument["layout"];
  sections: Section[];                 // with SAMPLE copy for thumbnails
  skin?: Pick<WidgetThemeConfig, "theme" | "radius" | "font">;
};
```

| id | Layout | Sections (in order) | Skin |
|---|---|---|---|
| `classic` | column | header · booking | none |
| `profile` | column | header · about (photo) · services (list) · links · booking | light · round · lora |
| `studio` | column | hero · services (cards, prices) · gallery · testimonials · booking · location | dark · subtle · space-grotesk |
| `split` | split | hero · about · services · faq · location · booking | light · subtle · dm-sans |
| `team` | column | header · staff · services · booking · location | light · subtle · inter |
| `minimal` | column | hero (no image) · booking · links | light · none · system |

- **Picker**: dialog with one card per template. Thumbnails are the real `PageRenderer` (`mode: "preview"`, sample copy, the org's real name/logo/services) in a scaled frame (`transform: scale(.35)`, fixed aspect box, `pointer-events: none`). No static images to maintain.
- `applyTemplate(t): PageDocument` — deep-copies sections, assigns fresh ids, **strips sample copy** (text props → `""`, image paths → `undefined`, list items kept with empty fields for `faq`/`testimonials`/`links`, gallery images removed). Result is a valid document (tested for every template).
- Applying replaces the draft. If the draft differs from `DEFAULT_PAGE`, confirm: "Replace your current draft? Your published page stays until you publish."
- Checkbox **Also apply this look (theme, font, radius)** — on by default when the template has a skin. Writes via the existing `updateWidgetTheme` with `{ ...current, theme, radius, font, background: undefined, text: undefined }`: accent, logo and `hidePoweredBy` are never touched; bg/text overrides are cleared so the skin's surface reads as designed.

## Media

- Bucket: existing public `branding` bucket (`BRANDING_BUCKET`). Path `{orgId}/page/{sha256 first 16 hex}.{ext}` built by `pageImagePathFor` (sibling of `logoPathFor`).
- `uploadPageImage(formData)` server action: org membership; `PAGE_IMAGE_MAX_BYTES = 5 MB`; raster only — `image/png`, `image/jpeg`, `image/webp` — checked by declared type **and** magic bytes (reuse `matchesLogoMagicBytes`; SVG excluded). Returns `{ ok: true, path }` (an `ActionState` extended with the path). Checksum paths make re-uploads idempotent (upsert).
- No resizing or CDN transforms. Sections render `<img loading="lazy" decoding="async">` with `sizes`; the upload control hints "Best under 2000 px wide".
- Caps: ≤24 image references per document (schema). Worst case ≈120 MB per org.
- **Orphans**: `publishBookingPage` and `discardBookingPageDraft` (server actions, after the RPC succeeds) list `{orgId}/page/` and delete every object not referenced by `draft ∪ published` (pure `orphanPaths(listed, referenced)` in `images.ts`). Images removed from a draft before publish linger until the next publish/discard — acceptable.
- The `branding` bucket's `file_size_limit` is raised from 1 MB (0018) to 5 MB in migration 0049; logos keep their 1 MB app-level check.

## Plan gating

None in v1 — every template and section is available on Free. One entitlement key is wired now so gating later is a constants flip:

- `PlanLimits.pageSections: "basic" | "all"` — `"basic"` = `header`, `booking`, `about`, `links` (a link-in-bio page); `"all"` = everything. All plans → `"all"` in v1.
- The palette reads it (gated types disabled with a "Pro" tag); `publishBookingPage` re-checks it server-side and refuses with a clear error if the draft contains gated visible sections.
- No per-org feature flag: the feature is inert until an org publishes, which is opt-in by construction.

## Error handling

- **Autosave** failure → status pill *Couldn't save — retry*, toast once; local state is kept.
- **Publish / discard** RPC failure → error toast, state unchanged. Orphan cleanup failure after a successful RPC → `console.error` only (never surfaces as a publish failure; next publish retries).
- **Upload**: wrong type / too large / magic-byte mismatch → inline field error with the reason; storage failure → inline generic error.
- **Template apply** skin write failure → the draft is still applied; toast "Template applied, but the look couldn't be saved".
- **Public**: parse failure → default composition (logged). Unknown `?service=` → ignored.
- **RPC** rejections (non-member, oversized, no booking section) → uniform failure message (established idiom).

## Testing

- **Unit (Vitest):** schema — valid documents for every template and `DEFAULT_PAGE`; rejects zero/two booking sections, duplicate single-instance types, >20 sections, >24 images, over-length text, non-`https:` links (and the `tel:`/`mailto:` exceptions), image paths outside the org prefix; `parsePageDocument` returns null on junk; `applyTemplate` strips sample copy and yields a valid doc (table over `TEMPLATES`); `pageMetadata` precedence; `orphanPaths`; unpublished deep-equal; `resolveInitialService`; `issuesBySection`; the document ops (`insert`/`remove`/`move`/`replace`/`hide`, empty rule, summary); gating rule.
- **Integration (Supabase):** `save_booking_page_draft` — member OK / non-member rejected / >64 KB rejected / missing booking rejected / `version != 1` rejected; `publish_booking_page` copies draft → published and stamps `published_at`; `discard_booking_page_draft` reverts to published, or to the supplied fallback when never published; `getPublishedPage` returns only `published`; RLS — a member of another org cannot select the row.
- **No component tests** — the repo has none (`vitest` collects `*.test.ts` only, node environment); every decision lives in a pure `.ts` module with a test, and section/studio components stay thin.
- **Manual browser checklist (Playwright MCP during QA):** pick *Studio* → fill hero → publish → `/book/<handle>` shows it, staff page inherits without the staff section; `?service=` preselects; keyboard reorder; Split at `lg` and stacked on mobile; dark skin; ghost placeholders never appear publicly; contrast notices still show.

## Out of scope

Free canvas / absolute positioning; per-section style overrides (colours, spacing, alignment beyond hero `align`); inline text editing in the preview; multiple pages per org; version history / undo across sessions; custom domains; embedded maps; opening-hours section (derived from availability); markdown or HTML; image resizing / CDN transforms; per-staff custom pages; template marketplace; plan gating beyond the wired key.

## Notes

- Migration numbers **0047** (table), **0048** (security) and **0049** (bucket cap). Rentals R3, if ever un-parked, renumbers from 0050 (same hazard as noted in the R3 and Team notes).
- `applyTemplate` skin write reuses `update_org_widget_theme`; no new theme RPC.
- Post-implementation: `graphify update .` (repo rule).
