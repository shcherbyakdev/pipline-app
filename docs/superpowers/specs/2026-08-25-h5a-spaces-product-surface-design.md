# H5a — Spaces on the product surface

**Date:** 2026-08-25 · **Status:** approved · **Branch:** feat/h5a-spaces
**Roadmap:** first half of slice H5 of `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`
(H5b — landing, pricing page, per-resource `PLANS`, `FORBIDDEN_COPY` — is its own spec, after the first H0 interviews)
**Depends on:** H3 (merged, PR #56) · PR #57 (week-view walk-in) · PR #58 (previews render rentals)
**Migrations:** none — H4 keeps 0059

A space owner can already *sell* through the hosted page and the embed
(`listPublicCatalog` lists and books rentals since R1), but cannot *present*
their rooms the way a salon presents its services: the page builder has no
rentals section, its templates are appointments-shaped, and every label a
space owner reads says "Rentals" or "appointment". This slice adds a
`spaces` builder section, makes templates fit the org's mode, and renames
the channel "Spaces" on the surfaces a client reads and the entry points a
provider uses. No data model change, no RPC change, no money.

## Rulings (settled in brainstorming)

1. **H5 is split.** H5a (this spec) is product surface and needs nothing from
   H0. H5b is go-to-market and waits for willingness-to-pay answers.
2. **Photos live in the page document**, keyed by offering id — the builder's
   existing pattern (hero/about/gallery `imagePath`, page-images bucket, 0049
   cap). No column on `rental_offerings`. One page per org makes "per page"
   and "per offering" the same thing today; moving the photo onto the
   offering later is mechanical.
3. **A Spaces card pre-selects its offering** in the booking widget — the
   exact analog of the services section's `requestedService` hand-off.
4. **The channel is called "Spaces"** wherever a person reads it. Code
   identifiers (`rental_*`, `offersRentals`, `/rentals`) do not change.
   Nights/days gear stays supported under the same word.
5. **Templates fit the mode** when applied or previewed (`services` ↔ `spaces`
   swap/insert, `staff` dropped for rentals-only), plus one photo-led
   **"Venue"** template that is first in the picker for rentals-only orgs.
6. **The claim flow is untouched.** New orgs still start on `DEFAULT_PAGE`
   (header + booking); the widget inside it already lists spaces.
7. **Copy pass = client-facing surfaces + provider entry points.** Emails and
   admin page intros are audited into the deferred list, not changed.

## Section model

### `spaces` (page document, `schema.ts`)

```ts
export const spacesSection = z.object({
  ...base, type: z.literal("spaces"),
  title: text(60),
  style: z.enum(["list", "cards"]),
  showPrices: z.boolean(),
  showStay: z.boolean(),          // "min 2 nights" · "1 h–4 h" — the showDurations analog
  photos: z.array(z.object({ offeringId: z.string().uuid(), path: imagePath })).max(12),
});
```

- Joins `SECTION_TYPES`, the discriminated union, `SINGLE_INSTANCE_TYPES`
  and `ADDABLE_TYPES`. Not in `BASIC_SECTION_TYPES` (every plan is `"all"`
  today; the gate stays wired as for `services`).
- `imagePathsIn` includes `photos[].path`, so the section counts toward
  `PAGE_LIMITS.images` and the bucket's orphan cleanup sees them.
- `photos` may hold at most one entry per `offeringId` (superRefine). A photo
  whose offering is gone is ignored at render and dropped by the inspector on
  the next edit of the section — never a validation error on load.
- The section lists **every active offering in catalog order**. There is no
  per-page subset; a provider hides a space by deactivating the offering.
- `newSection("spaces")` → `{ title: "Spaces", style: "cards", showPrices: true, showStay: true, photos: [] }`.
  `stripSample("spaces")` keeps the section as-is (live section, like services).
- `SECTION_META.spaces = { label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." }`.

### Page state (`render/page-state.tsx`)

```ts
type Request = { kind: "service" | "offering"; id: string; key: number } | null;
type PageState = { requested: Request; selectService: (id) => void; selectOffering: (id) => void };
```

`PageStateProvider` keeps `initialServiceId` (the `?service=` deep link) and
gains nothing else on its props. The booking section maps `requested` to
the widget's `requestedService` / `requestedOffering` by `kind`.

## Rendering

### `render/sections/spaces.tsx`

Same shape as `services.tsx`:

- `ctx.offerings.length === 0` → `Ghost("Add a space and it shows here")`.
- list: bordered, divided rows; cards: `grid sm:grid-cols-2`. Card content, top
  to bottom: photo (when the section has one for this offering; `aspect-[4/3]`,
  `object-cover`, rounded per `--widget-radius`) · name · description · meta
  line. Meta = `[showPrices ? formatOfferingPrice(o, currency) : null,
  showStay ? stayHint(o) : null].filter(Boolean).join(" · ")` where `stayHint`
  is the widget's existing hint logic pulled into `features/rentals/pricing.ts`
  (hours → "1 h–4 h"; minStay > 1 → "min 2 nights"; else null) so widget and
  section can't drift.
- Click → `selectOffering(o.id)`; public mode scrolls to `#book`, preview does
  not (the services section's rule).

### Booking widget (`booking-widget.tsx`)

- New prop `requestedOffering?: { id: string; key: number } | null`, applied
  during render exactly like `requestedService` (own `appliedOfferingKey`):
  `setOffering(found)`, `setService(null)`, `setStaffChoice(null)`, `setSlot(null)`.
  In preview the rental flows are never mounted (#58's inert rule): the
  flows branch becomes `offering && !preview`, so a request is applied to
  state but the list stays on screen and nothing fetches.
- Group heading "Stays &amp; rentals" → "Spaces" (rendered only when services
  are present, as today).

### Booking section (`render/sections/booking.tsx`)

Passes `requestedService={requested?.kind === "service" ? requested : null}`
and `requestedOffering={requested?.kind === "offering" ? requested : null}`.

### Public page and embed

No route changes. A `services` section on a rentals-only org's page (or
`spaces` on an appointments-only page) renders nothing publicly and a Ghost
in the builder — the existing empty-services behaviour, extended.

## Builder

### Mode reaches the studio

`/booking-page` already resolves `effectiveMode(flags, modeOf(org))` (#58).
`BookingPageBuilder` receives `mode: OrgMode` and threads it to the sections
panel, the template picker and the inspector.

**Amended 2026-08-27:** the mode the builder (and the Website embed preview)
receives is `presentMode(effective, { services, spaces })` — the declared
mode narrowed to channels with something bookable, unchanged only when the
org has nothing anywhere yet. An org that declared spaces but has none
(every pre-mode-picker org, `create_org` defaults both on) previews,
templates and adds sections as the appointments page it is; add the first
bookable space and Spaces appears everywhere at once. The public page keeps
`listPublicCatalog`'s declared-mode gate — it only lists real rows anyway.

### Palette

```ts
export function addableTypes(mode: OrgMode): SectionType[]
```
`ADDABLE_TYPES` minus `spaces` unless `mode.offersRentals`, minus `services`
and `staff` unless `mode.offersAppointments`. `AddSectionPopover` consumes it;
the single-instance and plan gates apply after, unchanged.

### Inspector — `SpacesForm`

Title · Style (list/cards) · "Show prices" · "Show stay / duration" · **Photos**:
one row per active offering (from `ctx.offerings`, catalog order) with the
offering name and the existing `ImageField` (same upload action, same
limits). Removing a photo deletes its entry; the form also drops entries
whose offering is no longer active or present. Offerings are read-only
here — a link "Manage spaces" goes to `/rentals`.

### Publish guard

`spaces` joins the sections that may be empty: the existing "X won't show on
the published page. Publish anyway?" dialog names it via `SECTION_META`.

## Templates

### `fitToMode(sections, mode)` (pure, `templates.ts`)

| mode | transform |
|---|---|
| rentals-only | each `services` → `spaces` (style carried over, title "Spaces", prices + stay on, `photos: []`); `staff` sections dropped |
| both | insert `newSection("spaces")` (cards) right after the `services` section (single-instance, so at most one); nothing dropped |
| appointments-only | `spaces` sections dropped |

`applyTemplate(t, mode)` = `fitToMode(t.sections, mode).map(stripSample)`;
`templatePreview(t, mode)` = `fitToMode(t.sections, mode)` — thumbnails show
what applying gives. Section ids in inserted/converted sections are fresh
(`newSectionId`), except in `templatePreview`, which derives them
deterministically from the source id — `("sp" + id).slice(0, 12)`, which
satisfies the schema's `/^[a-z0-9]{6,12}$/` — so thumbnails are stable.

### "Venue" template

```
id "venue" · name "Venue" · description "Photo-led cover, your spaces with prices, a gallery and where to find you."
layout column · skin { theme: "light", radius: "subtle", font: "system" }
hero      headline "Rooms by the hour in Podgórze" · subheadline "Rehearsal, recording and workshop space. Pick a room, choose your hours, book online." · align center
spaces    cards · showPrices · showStay
gallery   3 columns
location  sample address + maps link (same sample as Studio)
booking   title "Book a space"
faq       [{ q: "Can I cancel?", a: "Yes — see the cancellation window on each space." }, { q: "What's included?", a: "The room, the listed gear, and the door code by email." }]
```

### Picker (`template-picker.tsx`)

`templatesFor(mode)` (pure): rentals-only → Venue first, then the rest;
both → existing order with Venue after Studio; appointments-only → Venue
omitted. Thumbnails render `templatePreview(t, mode)` with the preview
catalogue (#58). *2026-08-27:* `mode` here is the present mode (above);
Venue's booking section now follows its Spaces section directly, and its
cover carries a "Book a space" button (builder spec, Templates amendment).

## Vocabulary — "Spaces"

`src/features/orgs/vocab.ts` holds the strings; every surface below reads
from it so the word exists once.

| Surface | Today | H5a |
|---|---|---|
| Nav item (`/rentals`; path unchanged; page title via `titleForPath`) | Rentals | Spaces |
| Onboarding picker | Rentals — "Things people book by the night or day: rooms, cars, equipment." / Both — "You sell appointments and rentals." | Spaces — "Rooms, studios and gear, booked by the hour, night or day." / Both — "You book people and spaces." (Appointments blurb unchanged) |
| Widget group heading | Stays & rentals | Spaces |
| Page meta description (`metadata.ts`, `pageMetadata` gains `mode`) | Book an appointment with {org}. | rentals-only "Book a space at {org}." · both "Book with {org}." · appointments-only unchanged |
| `SECTION_META.spaces` | — | Spaces — "Your rooms, studios and gear, with photos and prices." |
| Embed iframe title | done in #58 | — |

`FORBIDDEN_COPY` (marketing site) is not touched — it is H5b's.

## Testing

Pure, `.test.ts` (house pattern — no component tests):

- `schema.test.ts`: `spaces` parses; >12 photos, non-uuid `offeringId`,
  duplicate `offeringId`, and a second `spaces` section are rejected;
  `imagePathsIn` counts spaces photos.
- `defaults.test.ts` / `templates.test.ts`: `newSection("spaces")` shape;
  `stripSample` keeps it; `fitToMode` — the 3×3 matrix (services / staff /
  spaces present) including "both" inserting right after the services section;
  `applyTemplate` ids are fresh, `templatePreview` ids are stable; `templatesFor`
  ordering per mode; Venue passes `pageDocumentSchema` in all three modes.
- `gating.test.ts`: `addableTypes(mode)`.
- `page-state`: the request reducer is extracted to a pure `nextRequest(prev, kind, id)`
  and tested (key increments, kind switches).
- `pricing.test.ts`: `stayHint` cases (hours range, min stay, none).
- `vocab.test.ts`: one assertion per surface string per mode (locks the table).
- `metadata.test.ts`: the three descriptions.

Browser QA (Playwright MCP, local stack) — matrix 3 modes × {builder preview,
published page, embed}: add Spaces, upload a photo, card click lands on that
offering's picker on the public page and stays inert in the previews, Venue
applied per mode, publish guard names Spaces, existing pages unaffected.

## Out of scope / deferred

- Photo on the offering row (`rental_offerings.image_path`, 0059 if ever) —
  needed only once the widget's step list or a marketplace wants photos.
- **Copy audit list** (not changed here): rental confirmation / reminder /
  cancel / reschedule emails, `/rentals` admin page intros and the offering
  dialog, the welcome banner's per-mode lines, the H3-noted provider-email
  gap for nights/days.
- Per-offering short links (`/{handle}/{offeringSlug}`); offerings have no slug.
- Claim-flow template seeding (Venue at sign-up) — ruled out for now.
- Per-page subset/ordering of spaces beyond catalog order.
- H5b: landing, pricing page, per-resource `PLANS` + entitlement remap,
  `FORBIDDEN_COPY`.
