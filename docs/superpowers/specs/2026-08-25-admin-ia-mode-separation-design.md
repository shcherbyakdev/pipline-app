# Admin IA — appointments and spaces, side by side

**Date:** 2026-08-25 · **Status:** approved · **Branch:** docs/admin-ia-spec (spec), then `feat/ia-u1` … `feat/ia-u4`
**Roadmap:** UX hardening between H5a and H5b of `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`; no roadmap slot moves.
**Depends on:** H5a (PR #59) **being on `main`** — it was merged into its stacked base `fix/previews-render-rentals` (ca2c5a8) and must be rebased onto `main` and re-merged first. This spec builds on its `orgs/vocab.ts`, `spaces` section and widget `requestedOffering`.
**Migrations:** none — H4 keeps 0059.

A both-modes studio (rooms by the hour *and* appointments) is a real customer
(R3 ruling: "a guesthouse that also does massages"), and it is the customer
the pivot spec's Venue/Studio positioning attracts. Today that admin lands
on a sidebar that interleaves three appointment nouns with one rental noun
and two channels, a Bookings screen with three vocabularies for its own
views and two "add a booking" buttons that use different words for the
bookable thing, hours editable in two unrelated places, and an integration
page that offers one iframe for everything. Nothing is architecturally
wrong — the object-first IA, the per-org mode preset, the single public
catalogue all match what Zoho, TIMIFY, Fresha and Skedda do — so this slice
changes grouping, vocabulary, the Bookings hub, hours, first-run guidance
and per-item links. No data model change, no RPC change, no money.

Evidence: browser walk of the demo org (`.playwright-mcp/ux-*.png`,
2026-08-25), a line-level audit of every admin route, and desk research on
Square, Acuity, Zoho, TIMIFY, Fresha, Bookeo, Mindbody, Picktime, Omnify,
SimplyBook, Skedda, Booqable, Cal.com and Calendly (Aug 2026).

## Rulings (settled in brainstorming)

1. **Object-first, grouped nouns** (approach A). Not mode sections
   ("Appointments" / "Spaces" sidebar groups — Bookeo's silo pattern, hours
   duplicated per group, Bookings/Clients/Booking page span both anyway) and
   not a workspace switcher (NN/g's mode error: one calendar is the owner's
   day). The sidebar groups answer *what do I sell* and *where do clients
   book*.
2. **Fixed nav order regardless of mode.** `Services · Spaces · Team ·
   Availability`. Single-mode orgs lose rows, never reorder. Putting spaces
   first is H5b's repositioning decision, not this slice's.
3. **"Spaces" extends to every admin surface.** H5a ruling 7 fenced admin
   page intros and dialogs into the deferred list; this slice lifts that
   fence for the admin. "Offering" and "rental" no longer appear in any copy
   a provider reads. Code identifiers (`rental_*`, `offersRentals`,
   `/rentals`) still do not change. Emails stay on H5b's audit list.
4. **Hours are edited in one place — `/availability` — for people and
   spaces.** A space's detail page shows a summary and a link, never a second
   editor. Team members and hourly spaces are the same kind of owner there
   (TIMIFY/Skedda: staff and rooms are one lane type).
5. **One "New booking" entry on the Bookings page; the kind is a field, not
   a button.** Drag-select, the toolbar button and a timeline cell click all
   open the same dialog. An appointment walk-in becomes creatable without
   dragging (editable date + start time).
6. **A staff lens still hides space bookings, but says so.** A person's week
   is a lens on their work (H2 ruling); the toolbar chip makes the hidden
   rows visible as a count with a one-click way out. Space lanes on the week
   grid are deferred.
7. **Deep links are query params** — `?service=<id>` (exists on the hosted
   page; the embed only knows `?staff=` today), `?space=<offeringId>` (new)
   and `?channel=services|spaces` (new, one channel only), all on the hosted
   page and the embed. Slugged short links need a migration and stay
   deferred.
8. **First-run checklist persists nothing.** It rides the existing
   `?welcome=1` banner and derives every tick from data that already exists.
9. **Settings › Business stays** (R3 relaxed the "Settings = per-user only"
   ruling for exactly this group); only its copy changes.

## 1. Sidebar and vocabulary (slice U1)

### Nav (`src/components/shell/nav.ts`)

```ts
export type NavSection = "main" | "offer" | "share" | "account";
export const NAV_SECTIONS: readonly NavSection[] = ["main", "offer", "share", "account"];
export const NAV_SECTION_LABELS: Record<NavSection, string | null> =
  { main: null, offer: "Offer", share: "Share", account: null };
```

| href | label | section | channel |
|---|---|---|---|
| `/overview` | Overview (flag) | main | — |
| `/bookings` | Bookings | main | — |
| `/clients` | Clients | main | — |
| `/services` | Services | offer | appointments |
| `/rentals` | `SPACES.nav` | offer | rentals |
| `/team` | Team | offer | appointments |
| `/availability` | Availability | offer | **— (was appointments)** |
| `/booking-page` | Booking page | share | — |
| `/embed` | Website embed | share | — |
| `/billing` | Billing (flag) | account | — |
| `/settings` | Settings | account | — |

- `sidebar-body.tsx` iterates `NAV_SECTIONS` (today a local
  `["main","configure"]` literal) so a new section can't be forgotten; the
  unlabelled `account` group is separated by the existing `gap-4` only.
- `navItemsFor` is unchanged apart from the rows above; `titleForPath`
  unchanged. The command menu keeps deriving its "Go to" group from the same
  list.
- `nav.test.ts`: the three modes produce exactly the rows above in that
  order; `Availability` present for every mode; no `configure` section
  remains anywhere (`grep` guard in the test).

Rendered, for a both-modes org:

```
Bookings
Clients
Offer
  Services
  Spaces
  Team
  Availability
Share
  Booking page
  Website embed

Billing
Settings
```

### Vocabulary (`src/features/orgs/vocab.ts`)

`SPACES` gains the admin words. Every string below is consumed from here;
none is inlined again.

```ts
export const SPACES = {
  nav: "Spaces", widgetGroup: "Spaces", section: {…}, pickerTitle: "Spaces",
  pickerBlurb: "Rooms, studios and gear, booked by the hour, night or day.",
  pickerBothBlurb: "You book people and spaces.",
  // admin (this spec)
  one: "space",
  newButton: "New space",
  dialogTitle: { new: "New space", edit: "Edit space" },
  back: "← Spaces",
  empty: "No spaces yet — a space is a room, studio or item clients book by the hour, night or day. Add one, then add its units.",
  unitsHint: "Units are the individual rooms or items a client is assigned — one per room.",
  field: "Space",                       // the walk-in select's label when only spaces are listed
  command: "New space",                 // ⌘K action
  settings: { label: "Spaces", blurb: "Rooms, studios and gear, booked by the hour, night or day." },
  add: "Add a space",                   // welcome checklist + Bookings empty state
} as const;

export const APPOINTMENTS = {
  settings: { label: "Appointments", blurb: "Services booked as time slots with your team." },
  add: "Add a service",
} as const;
```

Consumers and the strings they replace:

| Surface | Today | After |
|---|---|---|
| `/rentals` page empty state | "No rentals yet — a rental is a unit type…" | `SPACES.empty` |
| `offering-dialog.tsx` trigger / title | "New rental" / "Edit rental" | `SPACES.newButton` / `SPACES.dialogTitle` |
| `offering-dialog.tsx` section heading "Stay" | shown for hourly too | "Stay" for nightly/daily, "Session" for hourly |
| `units-editor.tsx` intro | — | `SPACES.unitsHint` (one muted line above the list) |
| `rentals/[id]/page.tsx` back link | "← Rentals" (literal) | `SPACES.back` |
| `command-menu.tsx` | "New rental offering" | `SPACES.command` |
| `business-settings.tsx` rows | "Rentals — Units booked by the night or day." / "Appointments — Services booked as time slots on your calendar." | `SPACES.settings` / `APPOINTMENTS.settings` |
| walk-in select label | "Offering" | "Service or space" (both) · "Service" · `SPACES.field` (§2) |
| `team/page.tsx` intro | "Everyone who can be booked. Each person has…" | "Your bookable people. Each has their own hours, services and booking link." |
| `scheduling-settings-form.tsx` currency hint | "Shown on rental prices and deposits." | "Shown on prices and deposits." |
| `bookings-list.tsx` empty state | "…add a rental offering and its units…" | §2 |
| `site.ts` `WELCOME` | "Add a rental offering" | `SPACES.add` (§4) |

A vocab test renders each consumer with a rentals-only and a both-modes org
and asserts none of the words `rental`, `Rentals`, `offering` appear in the
DOM text (badges "Hourly/Nightly/Daily" and the status labels are the
allowed exceptions, listed in the test).

## 2. Bookings hub (slice U2)

### View switcher (`features/scheduling/components/view-switcher.tsx`)

A segmented row of links (the `StaffTabs` idiom — navigation, not state) with
the same three labels from every view: **Week · Timeline · List**.

- `Week` always renders, including for rentals-only nights orgs (the week
  shows their stays as all-day chips).
- `Timeline` renders iff a nights/days space exists (`hasRangeOfferings`,
  already computed up front in `bookings/page.tsx`).
- `aria-current="page"` on the active view; the week link carries the
  `?staff=` lens, the others drop it (they have no lens).
- Default view is unchanged (`defaultBookingsView`).

Toolbar per view, left to right:

| view | left | right |
|---|---|---|
| week | `New booking` | `Today` · switcher |
| timeline | `New booking` | switcher (the timeline keeps its own ‹ Today › row) |
| list | `New booking` | switcher |

The Timeline component's internal "New rental booking" button is removed;
its empty-cell click keeps opening the dialog (below) with the space, unit
and date prefilled.

### One dialog (`features/scheduling/components/new-booking-dialog.tsx`)

```ts
type Initial =
  | { kind: "service"; serviceId?: string; date: string; startMin: number; dragEndMin: number; windows: DayWindow[] }
  | { kind: "space"; offeringId?: string; unitId?: string | null; date?: string };

export function NewBookingDialog(props: {
  open: boolean; onOpenChange: (o: boolean) => void;
  services: ServiceRow[];            // active
  spaces: OfferingOption[];          // active, any range mode
  staff: StaffRow[]; defaultStaffId: string;
  timeZone: string;
  initial?: Initial;
});
```

- Title "New booking"; description "Recorded on your behalf — notice and
  booking-window limits don't apply." (existing copy).
- First field: one native `<select>` (the dialogs' existing idiom) with
  `<optgroup label="Services">` and `<optgroup label="Spaces">`. Its label
  adapts: "Service or space" when both groups have entries, "Service" when
  only services, `SPACES.field` when only spaces — a single-mode org's dialog
  reads exactly as it does today.
- Below it, `<AppointmentBookingForm key={id} …>` or
  `<SpaceBookingForm key={id} …>`, chosen by which group the selected id
  belongs to. **`key` is the selected id** (H5a lesson: a flow keyed by the
  thing being booked never carries state across a switch).
- `AppointmentBookingForm` is `CreateBookingDialog`'s body extracted as a
  form (same `createBookingAdmin` call, overlap error, staff picker, client
  fields) plus two fields that are new: **Date** (`<input type="date">`) and
  **Start** (`<select>` of 15-minute snaps). Both are prefilled from a drag;
  from the toolbar they default to today and the next snap. The
  outside-hours hint renders only when `initial.windows` were supplied for
  the form's current date (the drag path); on a manually changed date it is
  omitted — admin bookings ignore hours by design, the hint was advisory.
- `SpaceBookingForm` is `NewRentalBookingDialog`'s body extracted as a form
  minus its own offering `<select>` (the shell owns selection). Range picker
  for nightly/daily, duration + time grid for hourly, unit select, client
  fields — unchanged.
- `CreateBookingDialog`, `NewRentalBookingDialog`, `RentalWalkInButton` and
  `rentals/walk-in.ts` are deleted; `calendar-week.tsx` and `timeline.tsx`
  mount `NewBookingDialog` directly (conditional mount per opening, the
  existing idiom, so each open starts clean).

Entry points and their `initial`:

| from | initial |
|---|---|
| toolbar button | none → first service if any, else first space |
| drag on the week grid | `service` with date/start/length from the drag; if the org has no active service, `space` = first hourly space with `date` |
| timeline empty cell | `space` with `offeringId`, `unitId`, `date` |

The drag popover renders only when at least one service or hourly space is
active (`canCreate`), so a rentals-only nights org no longer sees a
"New booking" popover that leads to an empty select.

### Kind at a glance

- Week grid, timed blocks: a space booking (`rentalUnitId !== null`) gets a
  12px house icon before its name and a **dashed** 3px accent bar instead
  of the solid one. Colour alone never carries the distinction (the
  accessibility rule the design skill flags first). All-day stay chips
  already sit in their own row.
- List rows (`bookings-list.tsx`) and client history rows
  (`clients/[id]/page.tsx`): `<Badge variant="outline">Space</Badge>` after
  the name for space bookings — **only when the org also offers
  appointments**. A rentals-only org would be badging every row.

### The lens says what it hides

`bookings/page.tsx` fetches the week **unfiltered** and applies the staff
lens in memory (one org-week of rows; it did the `.in("staff_id", …)`
narrowing in SQL only to save a filter). That yields the count for free:

```
[ 3 space bookings hidden · Show everyone ]
```

renders in the toolbar when the lens is on and the count is > 0; "Show
everyone" links to the same week without `?staff=`. Zero hidden → no chip.

### Empty state (`bookings-list.tsx`)

"No upcoming bookings. **Add a service** or **add a space**, then share your
booking page." — each link only for a channel the org offers; single-mode
orgs get one link and no "or".

## 3. One Availability page (slice U3)

### Owner resolution (`features/scheduling/availability-owner.ts`, pure)

```ts
export type Owner =
  | { kind: "staff"; id: string; name: string; color: string }
  | { kind: "space"; id: string; name: string };

export function resolveOwner(
  params: { staff?: string; space?: string },
  staff: StaffRow[],                 // active
  spaces: OfferingRow[],             // active AND rangeMode === "hours"
): Owner | null;
```

Order: a shape-valid `?staff=` naming an active member → a shape-valid
`?space=` naming an active hourly space → first staff → first hourly space →
`null`. The forgiving fallback rule is the page's existing one.

### `OwnerTabs` (replaces `StaffTabs` on this page)

Same segmented-link component, two clusters separated by a hairline:
**People** (colour dot + name, as today) then **Spaces** (house icon + name).
Renders when `staff.length + spaces.length ≥ 2`; `aria-label="Whose hours"`.
Hrefs: `/availability?staff=<id>` / `/availability?space=<id>`.
`StaffTabs` stays for the Bookings week header.

### Page (`app/(dashboard)/availability/page.tsx`)

- Owner `staff` → exactly today's body: intro line, `WeeklyHours
  owner={{staffId}}`, `DateOverrides owner={{staffId}}`.
- Owner `space` → same components with `owner={{ rentalOfferingId }}` and
  `getOfferingAvailabilityAdmin` (already used by `rentals/[id]`). Intro
  gains one sentence when the org also has nightly/daily spaces: "Nightly
  and daily spaces use check-in and check-out times instead — set those on
  the space."
- `null` owner: if the org offers appointments and has no active staff →
  existing "Nobody on the team is active…" copy; otherwise (nights-only
  rentals org) → "Nightly and daily spaces use check-in and check-out times,
  set on each space. Hourly spaces and team members set their weekly hours
  here." with a link to `/rentals`. **No redirect**: `availability/layout.tsx`
  drops its `!offersAppointments → /bookings` guard.
- `nav.ts`: Availability has no `channel` (table in §1).

### Space detail (`app/(dashboard)/rentals/[id]/page.tsx`)

The inline `WeeklyHours`/`DateOverrides` block is replaced, for hourly
spaces, by a summary card:

```
Opening hours
Mon–Fri 9:00–17:00 · Sat 10:00–14:00          Edit hours →
```

`summarizeWeekly(rules): string` (pure, `features/scheduling/hours-summary.ts`)
groups consecutive weekdays with identical windows, joins several windows
in a day with ", ", and returns "Closed — no hours set" for none. "Edit
hours →" links to `/availability?space=<id>`. Nightly/daily spaces keep the
check-in/check-out sub-line in the header and get no card.

## 4. First run per mode (slice U1)

`WelcomeBanner` gains a checklist row under its subtitle, computed on the
server only when `?welcome=1` (the page already branches on it):

```ts
export function setupChecklist(input: {
  mode: OrgMode; serviceCount: number; spaceCount: number;
  hourlySpaceCount: number; ownersWithHours: number; published: boolean;
}): { id: "service" | "space" | "hours" | "publish"; label: string; href: string; done: boolean }[];
```

| item | shown when | done when | href |
|---|---|---|---|
| `APPOINTMENTS.add` | `offersAppointments` | `serviceCount > 0` | `/services?new=1` |
| `SPACES.add` | `offersRentals` | `spaceCount > 0` | `/rentals?new=1` |
| "Set hours" | `offersAppointments \|\| hourlySpaceCount > 0` | `ownersWithHours > 0` | `/availability` |
| "Publish your page" | always | `published` | `/booking-page` |

Rendered as chips with a tick or an empty circle; the single CTA button is
replaced by the chips (Copy link and Dismiss stay). Subtitle copy per mode:
appointments-only keeps "Add a service and set your hours to go live.";
rentals-only "Add a space and its units to go live."; both "Add what you
offer, set hours, publish — then share your link." Counts come from
`listServices`, `listOfferings`, one `availability_rules` count grouped by
owner, and the builder's `getPageDraftState` (published or not); nothing
persisted (ruling 8).

## 5. Links & embeds (slice U4)

### Deep links

- `/[handle]` parses `?service=` today; `/embed/[handle]` parses only
  `?staff=`. After this slice both parse `?service=` and `?space=<uuid>`;
  `resolveInitialOffering(offerings, param)` mirrors `resolveInitialService`
  (shape-checked, must be in the gated catalogue, else `null` — an invalid
  id degrades to the org flow, never 404s). On the embed a `?service=` or
  `?space=` composes with a pinned `?staff=` the same way the hosted page's
  staff sub-page does: the pinned roster wins, an unbookable target is
  ignored.
- Hosted page: `PageStateProvider` takes `initialOfferingId` next to
  `initialServiceId`; the booking section maps it to the widget's
  `requestedOffering` (H5a prop). Embed: passed straight to
  `<BookingWidget requestedOffering={{ id, key: 0 }}>`.
- **Per-channel widget** (user request 2026-08-25): `?channel=services` /
  `?channel=spaces` restricts the widget's catalogue to one channel on both
  the hosted page and the embed — `listPublicCatalog` output is filtered
  after the mode gate, so an org that doesn't sell the requested channel
  degrades to its full catalogue (never a 404, never an empty widget). With
  one group the widget drops its group heading. Builder sections on the
  hosted page are unaffected (they are authored per page, not per link).
  `resolveChannelParam(mode, param)` is pure and tested like
  `resolveInitialService`.
- `lib/booking/url.ts`:

```ts
export type LinkTarget =
  | { service: string } | { space: string } | { staff: string }
  | { channel: "services" | "spaces" } | null;
export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string;
export function embedSnippet(appUrl: string, handle: string, target?: LinkTarget): string;
```

`embedSnippet` is the string the embed page builds today, moved here
(pure, testable), with `?service=`/`?space=`/`?staff=` appended to the iframe
`src` when a target is given.

### Website embed page

Under the snippet, a **Links & embeds** table (client component
`links-table.tsx`):

| row | link | embed |
|---|---|---|
| Whole booking page | copy | copy |
| Appointments only · Spaces only (both-mode orgs) | copy | copy |
| each team member (when > 1, with slug) | copy | copy |
| each bookable service | copy | copy |
| each active space | copy | copy |

Copy buttons use the awaited-clipboard idiom (`welcome-banner.tsx`), toast
on refusal. Rows carry a kind badge (Team / Service / Space) so the table
reads at a glance. Hidden entirely when the org has no handle (the page
already handles that state).

### Copy link on the thing

`services/` and `rentals/` list rows gain a `CopyLinkButton` (link icon,
`aria-label="Copy booking link"`, tooltip) that copies
`bookingLink(appUrl, handle, { service | space })`. Hidden when there is no
handle.

## Testing

- **Unit:** `nav.test.ts` per-mode rows/order/sections; vocab consumer DOM
  test (§1); `ViewSwitcher` in all three views incl. the Timeline
  condition; `NewBookingDialog` — group label per mode, keyed remount on
  switch, drag prefill, manual date/start path, `canCreate`; hidden-chip
  count from an in-memory lens; `resolveOwner`; `summarizeWeekly`;
  `setupChecklist`; `resolveInitialOffering`; `bookingLink`/`embedSnippet`.
- **Integration:** existing admin-RPC tests already cover `createBookingAdmin`
  and both rental creates; add one asserting an appointment walk-in from a
  manually chosen date/start round-trips.
- **Browser QA matrix:** 3 modes × { sidebar, Bookings week/timeline/list,
  New booking from toolbar/drag/timeline cell, Availability owner tabs,
  space detail summary, welcome checklist, embed links table, public
  `?space=` } — ledger in the worktree's `.superpowers/` progress file, as for
  H5a.

## Out of scope / deferred

- Space lanes (columns per room) on the week grid; the lens chip is the
  interim.
- Dependent resources — a service that *requires* a room (TIMIFY "dependent",
  Fresha "requirement"). New data model; own spec if asked for.
- Rentals-first ordering, landing/pricing copy, `FORBIDDEN_COPY`, email
  copy audit — H5b.
- Reschedule for space bookings (still cancel + rebook).
- Slugged short links `/<handle>/<space-slug>`; popup / element-click embed
  modes (Cal.com style). Query-param links and the inline iframe cover the
  integration story for now.
- Per-unit hours (pivot ruling: offering-level only).
- Persisting checklist/dismissal state.
