# H5b — Repositioning: per-resource plans, spaces-first admin, copy audit

**Date:** 2026-08-25 · **Status:** approved · **Branch:** feat/h5b (off main)
**Roadmap:** second half of slice H5 of
`2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`; follows
H5a (`2026-08-25-h5a-spaces-product-surface-design.md`) and the admin IA
slice U1–U4 (`2026-08-25-admin-ia-mode-separation-design.md`).
**Depends on:** main at `e746b8f` (U4 #64, landing redesign #65 merged).
**Migrations:** none — H4 keeps 0059.

The roadmap's H5 promised three things beyond H5a: Booklo's own plans move
from per-seat to **per-resource** (a bookable person and a unit of a space
both count), the provider's side of the product puts **spaces first**, and
the copy that still says "appointment" where a client may be booking a
room gets audited. This spec settles all three without touching the
landing page, which was redesigned the same day (#65) and already sells
both channels.

## Rulings (settled in brainstorming, 2026-08-25)

1. **Positioning is spaces-first in the product, not on the landing.**
   Nav, onboarding picker, New-booking groups, Links & embeds rows,
   Settings › Business rows, welcome checklist and the template picker put
   Spaces before Services/Appointments. The landing, the public widget's
   group order, the builder's `fitToMode` insertion point and every
   published page are untouched — a provider already controls page order
   in the builder, and a second landing rewrite the day after the first is
   not worth it before H0 answers exist.
2. **Fixed tiers, resources replace seats, prices unchanged for now.**
   Free 1 · Pro 3 · Team 10 bookable resources. `$12` / `$29` stay as
   placeholders: they are one line each in `plans.ts` and the `billing_mrr`
   view (0043), and the H0 willingness-to-pay answers set the real numbers
   before the billing flag flips. "+ per extra resource" (quantity checkout,
   billing spec §8 item 3) is deferred to the billing flip.
3. **Cap at the read + explicit unit pick; no migration.** The rental RPCs
   auto-pick a unit in SQL from every active unit (`order by sort_order,
   created_at limit 1`), so a read-side filter alone would leak. When the
   plan hides at least one unit of a space, the public create action passes
   the engine's first allowed free unit explicitly and retries with the next
   on a lost race; otherwise `p_unit_id` stays `null` and flag-off behaviour
   is byte-identical to today. (Alternative rejected: RPC candidate arrays
   like 0052 did for staff — strict in SQL, but it takes 0059 for a cap
   that is flag-off for every org today.)
4. **People fill the slots first, then units.** A both-mode org on Pro with
   one person and three units loses its fourth unit, never a whole channel.
   Consequence: a both-mode org on **Free** has its one slot taken by the
   person, so its spaces are hidden from the public page until it upgrades
   or turns appointments off in Settings › Business. The usage meter says
   exactly that.
5. **A resource only counts for a channel the org sells.** People count when
   `offersAppointments`, units when `offersRentals` (and the rentals flag is
   on). Every org has a backfilled staff row (U3 ruling); a spaces-only org
   must not spend its Free slot on it.
6. **Emails stay kind-blind.** The templates only know `serviceName` and
   `whenLine`; the three sentences that say "appointment" or "slot" become
   neutral rather than growing a `kind` parameter.
7. **`FORBIDDEN_COPY` grows, it does not shrink.** `offering` and `rentals`
   join the list; `stripe` / `payment` stay until H4 ships (roadmap: "drop
   after H4").

## 1. Per-resource plans

### 1.1 `src/lib/billing/plans.ts`

- `PlanLimits.bookableStaff` → **`bookableResources`**. Doc line: *Bookable
  things the PUBLIC page may offer: active people (when the org offers
  appointments) plus active units (when it offers spaces). Team: = seats.*
  The rename propagates through `Entitlements`, `bookable.ts`, `gates.ts`,
  `entitlements.ts`, `usage-meters.tsx`, `plan-banner.tsx`,
  `plan-picker.tsx`, `fake-emulator.ts`, `overrides.ts`, `stripe.ts`,
  `public-offering.ts` (the `UNLIMITED` constant) and their tests.
- `TEAM_INCLUDED_SEATS = 5` → **`TEAM_INCLUDED_RESOURCES = 10`**. The
  `org_subscriptions.seats` column keeps its name — it is the provider-row
  cache, `entitlementsFor` still reads it for Team, and the fake emulator,
  the comp override and the Stripe mapping write the new constant into it.
  No migration; `billing_mrr` sums `seats` and mirrors the unchanged prices.
- Limits: Free `bookableResources: 1` · Pro `3` · Team
  `TEAM_INCLUDED_RESOURCES`. `publicServices` (Free 3) and the reminder
  quota are unchanged. Spaces (offerings) are uncapped — units are the cap.
- Blurbs:
  - Free — *Everything one person — or one room — needs to take bookings.*
  - Pro — *Your brand, unlimited services, reminders for every booking, up to
    three bookable people or units.*
  - Team — *Up to ten bookable people and units, auto-assigned.*
  The plan ids and display names stay (`team` is in Stripe price metadata
  and the MRR view); a display rename is one string, later.

### 1.2 Copy that reads the limit

| Surface | Today | H5b |
|---|---|---|
| `PRICING.rows[0]` (`site.ts`) | "Publicly bookable team members" 1 / 1 / 5 | "Bookable resources — people and units" 1 / 3 / 10 |
| `PRICING.sub` | "Free for solo providers. Pay when you need your brand, unlimited services or a team." | "Free for one person or one room. Pay when you need your brand, unlimited services or more bookable resources." |
| `FAQ` "What does it cost?" (billing-on branch) | "…one bookable person, three services…" | "Free for one person or one room — one bookable resource, three services, reminders for your first 30 bookings each month. Pro and Team add your brand, unlimited services and more bookable people and units; see Pricing." |
| `plan-picker.tsx` `PLAN_ROWS[0]` | "Bookable team members" | "Bookable resources (people + units)" |
| `usage-meters.tsx` staff tile | "Bookable team members N / M" | "Bookable resources N / M" where N = `countResources(usage, mode)`; captions, first match wins: both-mode org with `bookableResources === 1` and `activeUnits > 0` → "your person takes the slot — spaces need a second resource"; N > M → "only the first M are bookable publicly"; else "people and units on your booking page" |
| `plan-banner.tsx` | "Your plan allows M bookable team members; K people aren't bookable publicly." | "Your plan allows M bookable resources (people and units); K aren't bookable publicly." |
| `scheduling/schema.ts` `planLimitStaffError(max)` | "Team members are on the Team plan…" / "Your plan allows N team members…" | **`planLimitResourceError(max)`**: max 1 → "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more."; else "Your plan allows {max} bookable resources — people and units together. Upgrade in Billing to add more." `PLAN_LIMIT_STAFF_ERROR` is deleted. |

`site.test.ts`'s corpus adds the three `PLANS[*].blurb` strings (they render
on /pricing and /billing) so the forbidden-word guard covers them.

### 1.3 Counting — `src/lib/billing/entitlements.ts`

```ts
export type ResourceUsage = { activeStaff: number; activeUnits: number };
/** The one counting rule (ruling 5). */
export function countResources(u: ResourceUsage, mode: OrgMode): number;
export function canAddResource(count: number, ent: Entitlements): boolean; // replaces canAddStaff
```

`BillingOverview.usage` gains `activeUnits` (one more `head: true` count on
`rental_units` where `active`, in the existing `Promise.all`) and
`BillingOverview` gains `mode: OrgMode`, taken from the `org` that
`requireOrg()` already returns (`offersAppointments`/`offersRentals`), so
the meters and the banner can call `countResources`. `canAddService` is
unchanged.

## 2. Enforcement

### 2.1 Pure seam — `src/lib/booking/bookable.ts`

```ts
export type UnitRef = { id: string; offeringId: string };
/** Which people and units the plan lets the public page book (ruling 4).
    Slots fill people-first in sort order, then units in the order
    listPublicUnitsForOrg returns them. A channel the org does not sell
    contributes nothing and consumes nothing (ruling 5). */
export function limitPublicResources<T extends { id: string }>(
  staff: T[], units: UnitRef[], mode: OrgMode, ent: Entitlements,
): { staff: T[]; allowedUnitIds: ReadonlySet<string> };
```

`limitPublicOffering` keeps its signature and semantics; it is fed the staff
subset from `limitPublicResources` and still narrows services to what those
people offer, then caps at `publicServices`.

### 2.2 Loader — `src/lib/booking/public-offering.ts` + `public.ts`

- `public.ts` gains `listPublicUnitsForOrg(orgId): Promise<UnitRef[]>` —
  active units of active offerings, ordered by offering `sort_order`, offering
  `name`, unit `sort_order`, unit `created_at` (the same order the RPCs and
  `loadOrgRangeContext` use, so "first N" means the same thing everywhere).
- `PlanLimitedOffering` gains **`allowedUnitIds: ReadonlySet<string> | null`**
  — `null` = no cap. `loadPublicOffering` returns `null` on the `UNLIMITED`
  path (billing off, fail-open) and never queries units there; with billing
  on it runs `limitPublicResources` over the roster and
  `listPublicUnitsForOrg`. `UNLIMITED.bookableResources` stays
  `Number.MAX_SAFE_INTEGER`. It also gains **`allowedSpaceIds: ReadonlySet<string>
  | null`**, derived from the kept units' `offeringId`s in the same pass, so
  `catalog.ts` filters spaces directly off `allowedSpaceIds` and needs no
  separate unit→space lookup.
- The loader needs the org mode and its three callers pass only an id
  (`catalog.ts`, `scheduling/public-actions.ts`, the staff-slug page), so
  the signature stays `loadPublicOffering(orgId)`. `public.ts` gains a
  per-request memoised `getOrgModeAdmin(orgId): Promise<OrgMode>` (admin
  client, `offers_appointments, offers_rentals` by id) that joins the units
  read inside the billing-on branch only — the flag-off path runs the same
  three reads it runs today. `listPublicStaff` is also wrapped in the same
  per-request `cache()` — now that `loadPublicResources` and
  `loadPublicOffering` both want the roster, memoising avoids a duplicate
  read.

### 2.3 Catalogue and deep links — `src/lib/booking/catalog.ts`

`listPublicCatalog` filters `offerings` to those with at least one id in
`allowedUnitIds` (no filter when `null`). A `?space=` deep link to a
capped-out space resolves through U4's `resolveInitialOffering` against
this filtered list, so it degrades to the org flow exactly as an inactive
space does today — no new copy.

### 2.4 Public actions — `src/features/rentals/public-actions.ts`, `hourly-actions.ts`

Both the availability reads (`getRangeAvailability`,
`getHourlyAvailability`) and the creates:

- After `loadOrgRangeContext` / the hourly context: `rangeUnits` (and the
  `units` returned to the widget's unit select) are filtered to
  `allowedUnitIds` when it is not `null`. The engine therefore never
  offers, and the client never sees, a hidden unit.
- Create with `unitId === null`: if `allowedUnitIds` is `null` **or** every
  active unit of this space is allowed, call the RPC with `p_unit_id: null`
  as today (DB auto-pick, one retry on a lost race). Otherwise iterate
  `unitsToTry(stay.unitIds, allowedUnitIds)`: call with each unit
  explicitly; a `taken` error moves to the next; exhausting the list →
  `DATES_TAKEN`. The hourly create uses the same helper over its own free
  set.
- Create with a client-picked `unitId` not in the allowed set → `DATES_TAKEN`
  (only a stale form can produce it; the select never lists it).
- `loadOrgRangeContext` itself, the admin walk-in/timeline/move paths and
  the reschedule panels are untouched: limits shape the public offering,
  never the data (billing spec §4.2).

### 2.5 Creation gates — `src/lib/billing/gates.ts`

- `evaluateStaffGate` → **`evaluateResourceGate(orgId, client, flags)`**: one
  read of the org mode + active staff count + active unit count, then
  `canAddResource(countResources(usage, mode), ent)`; refusal copy
  `planLimitResourceError(ent.bookableResources)`. `flags` is the org's
  resolved flags, passed in by the caller (which already needed them for the
  `billingOn` check) so `effectiveMode` can apply the rentals kill-switch
  before counting. Failure still refuses conservatively with
  `GENERIC_WRITE_ERROR` (spec §7.10).
- `assertCanAddStaff` keeps its name and its two call sites
  (`createStaff`, `setStaffActive(active=true)`) and now delegates to the
  resource gate. New `assertCanAddUnit` guards `createUnit` and
  `updateUnit` when it flips `active` false → true (`rentals/actions.ts`),
  behind the same `billingOn` check. Deactivating and deleting are never
  gated.

## 3. Spaces-first ordering (ruling 1)

| Surface | File | Change |
|---|---|---|
| Sidebar + ⌘K | `components/shell/nav.ts` | `offer` section order `Spaces · Services · Team · Availability`; `nav.test.ts` expects `["/rentals", "/services", "/team", "/availability"]` |
| Onboarding picker | `marketing/site.ts` `ONBOARDING.modes` | Spaces · Appointments · Both; `SPACES.pickerBothBlurb` → "You book spaces and people." |
| New booking | `scheduling/components/new-booking-dialog.tsx` | Spaces optgroup first; `SPACES.pickerBoth` → "Space or service" |
| Links & embeds | `orgs/link-rows.ts` | "Spaces only" before "Appointments only"; space rows before staff/service rows |
| Settings › Business | `orgs/components/business-settings.tsx` | Spaces row first |
| Welcome checklist | `scheduling/setup-checklist.ts` | "Add a space" before "Add a service" |
| Template picker | `booking-page/templates.ts` `templatesFor` | both-mode → `[...venue, ...rest]` (same as rentals-only) |

Untouched: Bookings view switcher (Week/Timeline/List is not a channel
order), widget group order, `fitToMode`, published pages, landing.

## 4. Copy audit and `FORBIDDEN_COPY`

### 4.1 Emails — `src/features/scheduling/templates.ts` (ruling 6)

| Template | Today | H5b |
|---|---|---|
| `bookingReminderEmail` | "A reminder about your upcoming appointment." (html + text) | "A reminder about your upcoming booking." |
| `bookingCancelledEmail` footer | "Need a new appointment? Book again any time on the booking page." | "Want to rebook? You can book again any time on the booking page." |
| `providerCancelledEmail` | "The slot is open again." | "The time is open again." |

Subjects already say "Booking confirmed / cancelled / rescheduled";
`providerNewBookingEmail` and the rest are neutral. The reminder drain
(`reminders.ts`) and both cancel paths pick these up with no call-site change.

### 4.2 Nights/days provider notice — `src/features/rentals/public-actions.ts`

`createRentalBooking` (nights/days) sends `providerNewBookingEmail` after the
client confirmation, mirroring `createRentalBookingHours`: `getProviderEmail`
resolved up front with its error swallowed and logged, its own `try`, `replyTo:
email`, idempotency key `bookingLifecycleKey(bookingId, "provider-new")`, the
same `infoLines`, `serviceName` = "{space} · {unit}" as the client mail.
Closes the gap H3 and H5a both noted.

### 4.3 Date overrides — `src/features/scheduling/components/date-overrides.tsx`

The intro "Days when your availability differs from your weekly hours." is
shown for hourly spaces since U3. The component takes the owner kind it is
rendered for (the `/availability` page already resolves it via
`availability-owner.ts`): person → today's line; space → "Days when this
space's availability differs from its weekly hours." (U3 deferral.)

### 4.4 `FORBIDDEN_COPY` — `src/features/marketing/site.ts` (ruling 7)

`["google", "calendar sync", "stripe", "payment", "offering", "rentals"]`.
`rentals` (plural) is the retired channel word; `AUDIENCE.groups`' "Gear
rental" is a business type and stays legal because the guard is a substring
match on the lower-cased corpus. The corpus adds the `PLANS` blurbs (§1.2).

## 5. Testing

Pure, `.test.ts` (house pattern — vitest node env, no component tests):

- `bookable.test.ts` — `limitPublicResources`: mode × cap matrix (appointments
  / spaces / both × 1 / 3 / unlimited), people-first order, unit order
  preserved, both-on-Free hides every unit, spaces-only ignores the staff
  row.
- `entitlements.test.ts` — `countResources` per mode, `canAddResource`,
  Team `seats` still lifts `bookableResources`.
- `plans.test.ts` — caps 1 / 3 / 10, `TEAM_INCLUDED_RESOURCES`,
  `planLimitResourceError` both branches.
- `gates.test.ts` — `evaluateResourceGate` with a stub client: person + unit
  counted per mode, refusal copy, failed read refuses.
- `nav.test.ts`, `link-rows.test.ts`, `setup-checklist.test.ts`,
  `templates.test.ts` (booking page) — the new orders.
- `templates.test.ts` (email) — the three sentences; the strings
  "appointment" and "slot" absent from every client/provider template body.
- `site.test.ts` — corpus + the two new words; `PRICING.rows[0]` cells 1/3/10
  read from `PLANS` so they cannot drift.
- `public-actions` explicit-pick order: the pure `unitsToTry` covers it;
  the action wiring is covered by the integration test below.

Integration (existing serial harness, `fileParallelism: false`):

- One test: org with billing on, no subscription (Free), spaces-only, one
  space with two active units. `listPublicCatalog` still lists the space;
  `createRentalBooking` with `unitId: null` twice for the same dates lands on
  unit 1 then returns `DATES_TAKEN` (unit 2 is hidden); a nights booking sends
  the provider notice through the fake transport with the `provider-new` key.

Browser QA (Playwright MCP, `localhost`, local stack): flag `billing` on for
the demo org via `/utils` → `/billing` meter "1 / 1"; both-mode org shows
the "spaces need a second resource" caption and no spaces on the public
page; fake-emulator upgrade to Pro → "N / 3", spaces back; nav, onboarding,
New-booking, Links & embeds, Settings orders; Mailpit shows the nights
provider notice and the new reminder/cancel wording.

## 6. Out of scope / deferred

- Landing copy and hero order (ruling 1).
- Real prices and "+ per extra resource" quantity billing — after H0, at the
  billing flip (billing spec §8 item 3).
- Plan display rename (`Team` → something venue-shaped); `team` id stays.
- RPC candidate-unit arrays (ruling 3 alternative) — revisit only if the
  explicit-pick loop shows up in logs as a race hot spot.
- A public cap on spaces (offerings) themselves; per-space unit caps.
- `stripe` / `payment` leaving `FORBIDDEN_COPY` — H4.
- Rental self-reschedule; slugged short links; everything already on the
  admin-IA and H5a deferred lists.
- Token-authenticated space reschedule (`rentals/manage-actions.ts`, R2/H2
  flows) stays uncapped until the billing flip: a client can move an
  existing stay onto a plan-hidden unit. Bounded (needs an existing booking,
  replaces rather than adds); revisit when billing goes live — run the
  manage contexts through the same cap and name the first allowed free unit.
- The gate and the billing meter count units of inactive spaces; the public
  allocator does not (it lists only active spaces' units). Conservative,
  never a leak; follow-up: filter by the owning space's `active` or cascade
  `active` on archive.

## Amendments (2026-08-26, at execution)

- §2.1: `unitsToTry` was NOT implemented (controller Ruling 1) — the create
  actions pass `stay.unitIds` / `match.unitIds` directly because the engine
  only ever saw allowed units, so the helper would have been an identity
  call. Its signature is dropped from the §2.1 code block and its mention
  is dropped from §5's `bookable.test.ts` bullet.
- §2.5: the gate is `evaluateResourceGate(orgId, client, flags)` — the
  callers pass the org's flags so `effectiveMode` can apply the rentals
  kill-switch; `assertCanAddUnit` runs only when the unit is (or becomes)
  active.
- §2.2: `PlanLimitedOffering` also carries `allowedSpaceIds` (derived from
  the kept units) so `catalog.ts` needs no unit→space lookup;
  `listPublicStaff` is per-request memoised.
- §6 gains two deferred items found in the whole-branch final review:
  token-authenticated space reschedule stays uncapped until the billing
  flip, and the gate/meter count units of inactive spaces while the public
  allocator does not.
