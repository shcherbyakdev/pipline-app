# Channel pages + booking-page starter

**Date:** 2026-08-28 · **Status:** approved (brainstorm 2026-08-28) · **Branches:** `feat/channel-pages` (off main), then `feat/booking-page-starter` stacked on it
**Builds on:** `2026-08-23-booking-page-builder-design.md` (templates, sections, `presentMode` amendments of 2026-08-27), `2026-08-25-h5a-spaces-product-surface-design.md` (§Builder, §Picker), `2026-08-25-admin-ia-mode-separation-design.md` (§4 welcome checklist, §5 `?channel=` links).
**Depends on:** main at `4a1d841` (#74 merged).
**Migrations:** 0059 (Drizzle, `booking_pages` shape) + 0060 (custom, backfill + RPCs). **H4 renumbers to 0061.**
**Supersedes:** PR #75 (`feat/booking-sections-split`, "appointments and spaces as separate booking sections", migration `0059_booking_pages_two_widgets`). It was merged into `feat/booking-page-smart-preview` *after* #74 squash-merged, so none of it is in main. It is not rebased; the branch stays as reference.

Today an owner lands on `/booking-page` on a bare header-plus-widget page, a
small "Start from a template" button they rarely open, and — before they
have added anything — a canned "Consultation" or "Studio A" in the
preview. An org that sells both appointments and spaces gets one page with
both audiences on it. This spec gives every channel its own page and makes
the first visit a short guided start: *what kind of business is this* →
*add your first service (or space) right here* → the page opens on the
template that fits, showing their real offering.

## Rulings (settled in brainstorming, 2026-08-28)

1. **The business-type choice lives on the first visit to `/booking-page`,
   not in onboarding.** `/onboarding` keeps its three-way "What are you
   booking?" (it drives nav, checklist and the public page); the business
   type is a finer cut that only the page needs.
2. **Adding the first service / space is an inline step of the same flow,
   not a redirect and not a soft nudge.** The builder opens only once the
   page's channel has something bookable. No "I'll add it later" skip — the
   sidebar remains the way out.
3. **One page per channel.** An org that sells both gets two page documents
   with their own template, copy and Publish; the covers cross-link. A page
   never carries two widgets — which is why #75 is superseded.
4. **The type list is the template picker.** Seven business types plus one
   "Something else" per channel, each mapped 1:1 onto an existing template
   (two Spaces types share Venue and differ in copy). Template names
   (Split, Profile, …) leave the UI. No new templates in this slice.
5. **The front door is derived, not chosen.** `/<handle>` is the
   appointments page when a bookable service exists, else the spaces page;
   `/<handle>/spaces` is always the spaces page. Choosing the front door is
   deferred (§7).

## 1. Vocabulary

Three channel words already exist and stay: `OrgMode`'s
`Channel = "appointments" | "rentals"` (`features/orgs/mode.ts`, what the
org sells), `lib/booking/channel.ts`'s `Channel = "services" | "spaces"`
(the `?channel=` query, what a link shows), and the provider-facing word
"Spaces" (`vocab.ts`). This spec adds **one** more, the stored page
channel, and two mappers so nobody invents a fourth:

```ts
// features/booking-page/channel.ts (pure)
export const PAGE_CHANNELS = ["appointments", "spaces"] as const;
export type PageChannel = (typeof PAGE_CHANNELS)[number];

/** The single-channel OrgMode a page renders with. */
export function pageChannelMode(ch: PageChannel): OrgMode;          // appointments → {true,false}; spaces → {false,true}
/** The ?channel= word applyChannel understands. */
export function toCatalogChannel(ch: PageChannel): "services" | "spaces";
export function parsePageChannel(raw: unknown): PageChannel | null; // ?page= on the builder
```

Provider-facing labels: `APPOINTMENTS.page = "Appointments page"`,
`SPACES.page = "Spaces page"` (vocab.ts). Cross-link copy (vocab.ts, the one
place the channels are named): `SPACES.crossLink = "Looking for a room? Book
a space →"`, `APPOINTMENTS.crossLink = "Need an appointment? Book a time →"`.
Starter copy (titles, step labels, field labels) lives in
`features/booking-page/copy.ts` (`STARTER`, `PAGE_SWITCH`), tested for the
`FORBIDDEN_COPY` words like `site.ts` is.

## 2. Data model

### `booking_pages` becomes one row per channel

| column | change |
|---|---|
| `org_id` | stays; FK cascade unchanged |
| `channel` | **new**, `text not null`, `check (channel in ('appointments','spaces'))` |
| PK | `(org_id, channel)` instead of `org_id` |
| `draft`, `published`, `published_at`, `updated_at` | unchanged |

Drizzle schema (`src/db/schema/booking-pages.ts`): `channel: text("channel").notNull()`, `primaryKey({ columns: [t.orgId, t.channel] })`. The header comment is rewritten: one page per channel, written only via the RPCs.

**Migration 0059** (Drizzle-generated, verified by eye in the plan): add the column with `default 'appointments'` so the existing rows fill, drop `booking_pages_pkey`, add the composite PK.

**Migration 0060** (`--custom`):
1. `check` constraint on `channel`.
2. Backfill: `update booking_pages p set channel = 'spaces' from orgs o where o.id = p.org_id and not o.offers_appointments;` — the existing row of a spaces-only org is its spaces page; every other org's row is its appointments page (a both-channel org's old page had the Services section first; its Spaces section empties out on the appointments page, see §3.4).
3. `alter column channel drop default` — callers always name the channel.
4. RPCs: drop the 0048 signatures and recreate with a channel:
   - `save_booking_page_draft(p_org_id uuid, p_channel text, p_doc jsonb)` — same ownership check (`p_org_id in (select public.user_orgs())`), same 64 KB guard, `insert … on conflict (org_id, channel) do update`.
   - `publish_booking_page(p_org_id uuid, p_channel text)` — copies that row's draft into `published`, sets `published_at`.
   - `discard_booking_page_draft(p_org_id uuid, p_channel text, p_fallback jsonb)` — draft := published, or `p_fallback` when never published.
   Each raises `'not found'` on an unknown org or a channel outside the check list. Grants unchanged (existing table; `authenticated` may `select` its own rows via the 0048 policy, and the policy needs no change — it keys on `org_id`).

The **document schema is untouched**: no `channel` on sections, `SINGLE_INSTANCE_TYPES` keeps `booking`, every stored page parses as before.

### Queries and actions

- `getPublishedPage(orgId, channel)` (cached, admin client) — the default composition when no row / never published / parse failure, exactly as today.
- `getPageDraftState(orgId, channel)` → `{ draft, published, publishedAt }`; `getPageStates(orgId)` → `Partial<Record<PageChannel, PageDraftState>>` in one query, for the builder's "any page published?" (§5.3) and the checklist (§4.4).
- Actions `saveBookingPageDraft`, `publishBookingPage`, `discardBookingPageDraft` take `channel` in their zod input (`z.enum(PAGE_CHANNELS)`); everything else unchanged. `revalidatePath` on publish covers `/[handle]` and `/[handle]/spaces`.
- `uploadPageImage` / `cleanupOrphans` are org-prefixed and channel-blind — unchanged.

## 3. Public routing

### 3.1 The routing rule (`lib/booking/channel-pages.ts`, pure)

```ts
type Has = { services: boolean; spaces: boolean };   // the GATED catalogue: mode ∩ flag ∩ bookable
export function frontDoor(has: Has): PageChannel | null;          // services → appointments; else spaces → spaces; else null
export function resolveChannelPage(route: "root" | "spaces", has: Has): { channel: PageChannel; canonical: "root" | "spaces" } | null;
export function channelPath(handle: string, ch: PageChannel): string; // appointments → bookingPath(handle); spaces → `${bookingPath(handle)}/spaces`
```

| route | has.services | has.spaces | result |
|---|---|---|---|
| root | ✓ | any | appointments page, canonical root |
| root | ✗ | ✓ | spaces page, canonical root |
| root | ✗ | ✗ | `null` → 404 (today's rule) |
| spaces | any | ✓ | spaces page; canonical **root** when `!has.services`, else spaces |
| spaces | any | ✗ | `null` → 404 |

A spaces-only org therefore keeps its address at `/<handle>`, and a shared `/<handle>/spaces` link never breaks when the org later adds a service — the spaces page only ever moves *from* the root, never off `/spaces`.

### 3.2 `/[handle]`

After the existing handle checks and `listPublicCatalog(org)`:
`has = { services: offering.services.length > 0, spaces: offerings.length > 0 }`; `page = resolveChannelPage("root", has)`; `null` → `notFound()`. Then:
- `?channel=spaces` while `page.channel === "appointments"` and `has.spaces` → `redirect(channelPath(handle, "spaces"))` (temporary — it depends on data). `?channel=services` is ignored (root already is the appointments page when services exist; otherwise it degrades as `applyChannel` does today).
- `cat = applyChannel(catalogue, toCatalogChannel(page.channel))` — the page's channel is forced, no longer a query.
- `doc = getPublishedPage(org.orgId, page.channel)`; `ctx.crossLink` per §3.5; `ctx.mode = "public"` as today. `?service=` / `?space=` resolve against `cat` as today.

### 3.3 `/[handle]/spaces` (new route file `src/app/[handle]/spaces/page.tsx`)

Same handle checks and alias redirect as the root. `resolveChannelPage("spaces", has)`; `null` → 404. Renders the spaces page with the catalogue forced to `spaces`. `generateMetadata` sets `alternates.canonical` to `bookingUrl(appUrl, handle)` when `canonical === "root"` (a spaces-only org — the same page lives at the root) and to the page's own URL otherwise. Shares the body with the root route through one `renderChannelPage({ org, handle, channel, catalogue, has })` helper in `features/booking-page/render/channel-page.tsx` so the two routes cannot drift.

Next matches the static `spaces` segment before `[staffSlug]`, so **`spaces` and `appointments` become reserved staff slugs** (`RESERVED_STAFF_SLUGS` in `staff-slug.ts`): `slugifyStaffName` returns `spaces-1` for a name that would slug to one, and the staff create/update actions reject a manual reserved slug with the existing slug-taken message. The plan checks the local and test DBs for a staff row already slugged `spaces` (none expected; a migration rename is not written unless one exists).

### 3.4 `/[handle]/[staffSlug]`

Unchanged except `getPublishedPage(org.orgId, "appointments")` and `crossLink: null` — a person's page is not a channel page.

`/embed/[handle]` (widget only, no document) and the admin `/embed` page (org-level `presentMode`, unchanged) are untouched.

### 3.7 Existing both-channel orgs after the backfill

Their old page is now the appointments page; its Spaces section receives an empty offerings list, `isSectionEmpty` marks it empty and `publicSections` drops it (existing behaviour), so nothing broken renders. The org's spaces page has no row → default composition (header + widget listing spaces) until they visit its builder tab, where the starter greets them (§5).

### 3.5 Cross-link

`RenderContext` gains `crossLink: { href: string; label: string } | null`.
- Public root/spaces page: appointments page with `has.spaces` → `{ href: channelPath(handle, "spaces"), label: SPACES.crossLink }`; spaces page with `has.services` → `{ href: bookingPath(handle), label: APPOINTMENTS.crossLink }`; else `null`.
- Builder preview: the other channel is present when `presentMode(declaredEffective, has)` has it (declared *and* bookable — a declared-but-empty channel gets no link, matching the public page); `href: "#"`, inert in preview like every other link.

`crossLinkHost(doc)` (`render/cross-link.ts`, pure): the first visible section when it is `header` or `hero` → `{ sectionId, placement: "header" | "hero" }`; otherwise the first visible `booking` section → `placement: "booking"`; `null` when neither (impossible for a valid document, kept total). `PageRenderer` computes it once and passes `crossLink` only to that section: header renders it right-aligned on the name row; hero renders it as a muted text link under the Book button (or where the button would be); booking renders it as one line above the widget. Same `CrossLink` component in all three; theme-token colours, no accent fill.

### 3.6 Links & embeds, metadata

- `linkRows` unchanged in shape; `bookingLink(appUrl, handle, { channel })` now returns the **path** (`spaces` → `channelPath(handle, "spaces")`, `services` → `bookingPath(handle)`). `embedSrc` keeps `?channel=` — the iframe is the widget, not a page. `url.ts` documents the split.
- `pageMetadata(doc, org, supabaseUrl, channel)`: description fallback = `bookingDescription(pageChannelMode(channel), org.orgName)` → "Book a space at X" / "Book an appointment with X" (closes the deferred "meta description uses declared mode" note from #74).

## 4. Builder: one page at a time

### 4.1 Route

`/booking-page?page=appointments|spaces`. The server:
1. `declared = effectiveMode(flags, modeOf(org))` as today.
2. `channel = parsePageChannel(sp.page)`; if `null` or not in `declared`, `channel = frontDoor(has) ?? (declared.offersAppointments ? "appointments" : "spaces")` where `has` is the org's bookable data (same inputs `presentMode` takes today).
3. `mode = pageChannelMode(channel)` — **not** `presentMode`: a page is its channel. `catalog = toPreviewCatalog({ mode, services, offerings })` hands the widget the channel's real rows or, when the channel has nothing yet, its canned stand-in (only ever the *page's* channel now — a both-declared org that only added services never sees "Studio A" on its appointments page, which is what the 2026-08-27 `presentMode` amendment was for; that amendment stays for the admin `/embed` page).
4. `states = getPageStates(org.id)`; `initialPage = states[channel] ?? { draft: DEFAULT_PAGE, published: null }`; `anyPublished = some state.published !== null`; `fresh = isFreshPage(initialPage)` (§5.1).
5. `crossLink` per §3.5 (preview flavour).

Props added to `BookingPageBuilder`: `channel`, `switchable: boolean` (declared both), `fresh`, `anyPublished`, `crossLink`.

### 4.2 Page switch

When `switchable`, a segmented control above the Sections/Settings tabs — *Appointments page · Spaces page* (`PAGE_SWITCH` copy) — renders as links to `?page=…` (navigation, not client state: the server loads the other draft; `usePageDraft` stays as it is). Not rendered for single-channel orgs. The live URL in the publish bar is `channelPath(handle, channel)` when the handle exists.

A legacy both-declared org that only ever sells one channel will see the switch; Settings › Business turns the unused channel off (existing control). Noted, not solved here.

### 4.3 Everything else follows the single-channel mode

`fitToMode`, `templatePreview`, `addableTypes`, `pickersOnPage`, `emptyVisibleSections` all take `mode`/counts that are now single-channel — no change to any of them. The Spaces inspector's photo rows, the Services/Spaces/Team sections and the widget see only the page's channel. Publish gating (`pageSections`) is per page, unchanged.

### 4.4 Welcome checklist

`ChecklistInput.published` = the **front-door** page's published state: the Bookings page computes `frontDoor({ services: serviceCount > 0, spaces: bookableSpaceCount > 0 })` and reads that channel's row from `getPageStates` (falls back to the declared-first channel when nothing is bookable yet, so the chip is still defined). The "Publish your page" chip links to `/booking-page` (the default page is the front door). The "Add a service" / "Add a space" chips keep pointing at `/services?new=1` / `/rentals?new=1` — both routes end in the same place as the starter.

## 5. The starter

### 5.1 When it opens

`isFreshPage({ draft, published })` (`studio/starter-state.ts`, pure) = `published === null && deepEqual(draft, DEFAULT_PAGE)`. Computed on the server per page (§4.1) and handed in as `fresh`. A page anyone has edited or published never shows the starter again on its own; `Start from a template` reopens the same dialog in picker mode (§5.4).

The dialog is not dismissable: no close button, `Esc` and outside clicks do nothing. Base UI 1.7's `Dialog.Root` has no `dismissible` prop, so the starter is a controlled `open` whose `onOpenChange` ignores every `false` (the reason arrives on `eventDetails.reason`; picker mode honours it). The admin sidebar stays usable — leaving the page is the escape, by ruling 2.

### 5.2 Business types (`features/booking-page/business-types.ts`, pure)

```ts
export type BusinessType = {
  id: string; channel: PageChannel;
  name: string; examples: string;           // "Salon & beauty" · "hair, nails, brows, tattoo"
  templateId: Template["id"];
  copy: { bookingTitle: string; cta: string };
};
export function typesFor(channel: PageChannel): BusinessType[];   // this channel's types, "Something else" last
export function applyType(t: BusinessType, mode: OrgMode): PageDocument; // applyTemplate + copy
```

| id | channel | name · examples | template | bookingTitle · cta |
|---|---|---|---|---|
| `solo` | appointments | Solo practitioner · coach, therapist, consultant | profile | Book a time · Book now |
| `salon` | appointments | Salon & beauty · hair, nails, brows, tattoo | studio | Book a time · Book now |
| `clinic` | appointments | Clinic & practice · physio, massage, dentist | split | Book a session · Book a session |
| `team` | appointments | Team & shop · barbershop, multi-chair salon | team | Book a chair · Book now |
| `online` | appointments | Online & lessons · tutoring, classes, remote | minimal | Book a lesson · Book now |
| `rooms` | spaces | Rooms, studios & gear · by the hour | venue | Book a space · Book a space |
| `stays` | spaces | Stays · nights & days | venue | Book a stay · Book a stay |
| `other-appointments` | appointments | Something else · a name and the widget | classic | Book a time · — |
| `other-spaces` | spaces | Something else · a name and the widget | classic | Book a space · — |

`applyType` = `applyTemplate(template, mode)`, then sets every booking section's `title` to `copy.bookingTitle` and every hero's `cta` to `copy.cta` (Classic has no hero — nothing to set). `stripSample` already keeps these (labels, not sample copy). The card thumbnail is `templatePreview(template, mode)` rendered by the existing `TemplateThumb` (real `PageRenderer`, org name/logo, real or canned catalogue) — the card *is* the preview of the template that fits. Cards show thumbnail · name · examples; "Something else" last.

### 5.3 Steps (`starter-state.ts` reducer, pure; `StarterDialog` renders it)

```
type → (needsFirstItem ? firstItem : apply) → done
```

- **`type`** — title `STARTER.title` ("What kind of business is this?"), sub `STARTER.sub`; the cards of `typesFor(channel)`. Click selects and advances. In *picker* mode (§5.4) with a dirty draft, the existing "Replace your current draft?" confirm sits between click and apply.
- **`firstItem`** — only when `needsFirstItem` (the page's channel has nothing bookable: `previewServices` is the canned stand-in / `previewOfferings` is the canned offering — decided from the ids `preview-service` / `PREVIEW_OFFERING_ID`, the existing canned markers). Title `STARTER.firstService` ("Add your first service") or `STARTER.firstSpace`.
  - Service form: **Name** · **Duration** select 15 / 30 / 45 / 60 / 90 / 120 min (default 60) · **Price** text, optional, placeholder from the org currency. Submits `createService({ name, durationMin, priceLabel })` — the schema's defaults cover the rest (`active: true`, no `staffIds` → everyone).
  - Space form: **Name** · **Booked by** radio hour / night / day (default hour) · **Price per hour/night/day** number, optional → `priceCents`. Submits `createOffering` with the offering dialog's defaults, lifted into one exported `OFFERING_DEFAULTS` constant in `features/rentals/schema.ts` so both forms agree (hours: increment 60, min 60, max 240; nights/days: 15:00 → 11:00, min stay 1; everything else schema defaults). The first unit and the default weekly hours come from `createOffering` itself (#70, #73).
  - Success → `router.refresh()`; the server re-renders with the real row in `previewServices` / `previewOfferings`; the dialog's client state survives the refresh (React keeps the component, and `usePageDraft` seeds `doc`/`published` from its props with `useState` — verified — so the refreshed props never reset the draft). Then `apply`. Failure (plan gate, network) → the action's message inline under the form; stays on the step.
  - No skip (ruling 2).
- **`apply`** — no screen of its own: `onApply(applyType(type, mode), skin)` → `draft.update`, `setSelectedId(null)`, toast "Template applied", dialog closes. Autosave persists the draft, so the page is no longer fresh.

**Look ("Also apply this look") — `skinDefault(anyPublished)`:** the checkbox is on the `type` step as today; default **ON when `anyPublished` is false** (no page of this org is published on any channel — the org-wide `widget_theme` is unclaimed), **OFF otherwise** (the skin would restyle the other live page and the embed). Picker mode keeps today's default OFF. Applying the skin uses the existing `applySkin` path (saves live, rolls back on failure).

### 5.4 Picker mode

`TemplatePicker` is replaced by `StarterDialog` with `variant: "starter" | "picker"`. Picker: the "Start from a template" outline button opens it, `type` step only (the channel already has items or the owner is choosing to keep stand-ins — `needsFirstItem` is still honoured if true), dismissable, existing replace-draft confirm, skin default OFF. Same cards, same copy. `templatesFor(mode)` and the Venue-first rule go away — `typesFor(channel)` is the order.

### 5.5 What the owner sees, end to end

New appointments org → `/onboarding` (unchanged) → `/bookings` welcome → "Publish your page" → `/booking-page`: starter opens over the default page → picks *Salon & beauty* → "Add your first service": *Balayage · 120 min · 450 zł* → the dialog closes on the Studio page with *Balayage* in the Services cards and the widget → publish. A both-channel org sees *Appointments page · Spaces page* above the tabs; the Spaces page opens its own starter with the two Spaces types; the published pages link to each other under the cover button.

## 6. Testing

**Unit (`npm run verify`, node env, pure modules only — repo rule):**
- `channel.ts`: `pageChannelMode`, `toCatalogChannel`, `parsePageChannel` (rejects arrays, unknown strings).
- `channel-pages.ts`: the §3.1 truth table for `resolveChannelPage` and `frontDoor`; `channelPath`.
- `cross-link.ts`: header-first, hero-first, booking-only, hidden-first-section skipped, total on an empty section list.
- `business-types.ts`: every `templateId` names a template in `TEMPLATES`; `typesFor` returns only its channel and ends in that channel's "Something else"; `applyType` output parses with `pageDocumentSchema` for every type × both single-channel modes, with the booking title and hero `cta` set; `stripSample` semantics preserved (no sample headline survives).
- `starter-state.ts`: `isFreshPage` (default draft + unpublished → true; edited draft → false; published → false), `skinDefault`, the step reducer (`needsFirstItem` true/false paths; `firstItem` failure stays put).
- `staff-slug.ts`: reserved names sidestepped by `slugifyStaffName`; `isReservedStaffSlug`.
- `url.ts`: `bookingLink` channel targets are paths; `embedSrc` channel targets stay queries.
- `metadata.ts`: fallback description per channel.
- `copy.ts` / vocab additions: `FORBIDDEN_COPY` guard.
- `setup-checklist.ts`: `published` now fed per front door — existing tests keep passing; the Bookings page's `frontDoor` wiring is covered by the channel-pages tests.

**Integration (`npm run test:integration`):** `rpc.integration.test.ts` extended — save/publish/discard on both channels of one org leave the other channel's row untouched; unknown channel raises; cross-org still refused; the backfill leaves a spaces-only org's row on `spaces` and an appointments/both org's on `appointments` (seeded orgs in both modes). Staff actions reject a reserved slug.

**Browser QA (localhost, per `browser-qa-localhost-lesson`):**
1. Fresh appointments org → `/booking-page` → starter → *Salon & beauty* → first service inline → Studio applied with the real service; reload → no starter; "Start from a template" → picker, replace confirm.
2. Both-channel org → switch visible; Spaces page starter with the two Spaces types → first space (hour) → Venue applied; publish both; `/<handle>` shows appointments with the cross-link; `/<handle>/spaces` shows spaces with the reverse link; `/<handle>?channel=spaces` redirects.
3. Spaces-only org → `/<handle>` is the spaces page; `/<handle>/spaces` renders with canonical root; no switch in the builder.
4. Demo org (customised, published) → no starter, published page byte-identical after the migration; its Spaces section no longer renders on the appointments page.
5. Team member named "Spaces" → slug `spaces-1`.

## 7. Out of scope / deferred

- **Choosing the front door** (a spaces-first org that also sells appointments wants `/<handle>` on spaces): needs a stored primary (orgs column + definer RPC) and a swap control — deferred until a real org asks.
- A **Stay** template variant (nights/days-specific cover and FAQ); both Spaces types share Venue for now.
- A **hub page** (front door with two big cards) — the cross-link covers it.
- **Persisting the business type** — it is a one-shot mapping; nothing reads it after apply.
- **Per-page skins** — the look stays org-wide (`widget_theme`); two pages, one look.
- An **"I'll add services later" skip** on the first-item step (ruling 2).
- Auto-renaming an existing staff member slugged `spaces` (none expected; checked in the plan).
- Rebasing PR #75 — superseded.

## 8. Delivery — two stacked PRs, one plan each

1. **`feat/channel-pages`** (off main): §1 vocabulary, §2 migrations 0059 + 0060 and channel-aware queries/actions, §3 public routes (`/[handle]`, new `/[handle]/spaces`, `?channel=` redirect, links row, reserved staff slugs, cross-link, metadata), §4 builder `?page=` switch with single-channel mode and the checklist front door. Invisible to single-channel orgs apart from the spaces link becoming a path. Ships with the migration integration tests and QA items 2–5 of §6.
2. **`feat/booking-page-starter`** (stacked on 1): §5 business types, `StarterDialog` (starter + picker variants) replacing `TemplatePicker`, `starter-state.ts`, the inline first-service / first-space forms with `OFFERING_DEFAULTS`, the look default, `copy.ts`. QA item 1 of §6 plus the starter half of item 2.

Order matters: the starter filters types by the page's channel and applies a template against a single-channel mode, both of which slice 1 provides. Each slice gets its own implementation plan via the writing-plans skill; slice 2's plan is written after slice 1 is reviewed, so its file references are real.

## 9. Memory / numbering

- Migration 0059 is taken by this spec (the stranded #75 also used 0059 on its own branch — that branch is never rebased). **H4 → 0061.**
- `feat/booking-sections-split` and the post-#74 commits on `feat/booking-page-smart-preview` are reference only.

## Amendments (2026-08-28, at execution)

- `channelPath` / `channelUrl` live in `lib/booking/url.ts`, not `channel-pages.ts` — `bookingLink` needs them and `channel-pages.ts` imports `url.ts` (a cycle otherwise). §3.1 / §3.6 read accordingly.
- The `channel` column keeps its `default 'appointments'` (schema and DB agree; only the RPCs write, and they always name the channel). §2 step 3 ("drop the column default") is withdrawn — dropping it would drift from the Drizzle schema on the next generate.
- The 0060 backfill is verified at migration time (psql, plan Task 3 step 5) and by QA item 3, not by an integration test: the harness cannot re-run a migration against seeded rows. §6 reads accordingly.
- `listPublicCatalog` is memoised per request (`react.cache`) so `generateMetadata` and the page resolve the channel from one read.
- The orphan-image sweep (`cleanupOrphans`) reads every page of the org — draft and published, both channels — before deleting; a one-page sweep would have removed images only the other page references.
- A `{ space }` link target (Links & embeds, the Spaces list) opens the SPACES page with the space preselected — `/<handle>/spaces?space=<id>` — because the root of a both-channel org is now the appointments page and no longer lists spaces; `{ service }` stays on the root, embeds keep `?space=`. §3.6 reads accordingly.
- The cross-link placement rule lives in `render/cross-link-host.ts` (pure), the component in `render/cross-link.tsx`; the spec's `cross-link.ts` + `cross-link.tsx` pair cannot coexist (same basename resolves to `.ts`).
