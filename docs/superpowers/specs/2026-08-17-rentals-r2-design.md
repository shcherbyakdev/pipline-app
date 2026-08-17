# Rentals — Slice R2 (unit timeline, rental reschedule/move, admin walk-ins)

**Date:** 2026-08-17
**Status:** Approved (brainstorm with Andrii)
**Parent:** `2026-08-17-rentals-r1-design.md` (R1, merged #34). R1's "R2" bucket was split: this spec is the daily-operations half; org mode flags / onboarding / vocabulary are the next, separate slice.
**Base:** `main` @ `a7f0f5e` (last migration `0038_create_rental_booking.sql`).

## Decision

R1 lets a rental business take bookings but gives the provider no per-unit view and no way to fix a booking. R2 closes that gap with three things that share one mechanic ("move a stay"):

1. **Unit timeline** — a Gantt on `/bookings`: rows = units grouped by offering, columns = days, 3-week rolling window; stays, blackouts and turnover tails drawn; click a bar → detail; click an empty cell → walk-in.
2. **Rental reschedule / move** — client (dates only, on the manage page) and admin (dates and/or unit, from list or timeline), both as *new booking + old row → `rescheduled`* with token rotation, mirroring appointments.
3. **Admin walk-in rentals** — `create_rental_booking_admin`, no throttle/notice/window, email optional.

Decisions with rejected alternatives:
- **3-week rolling window** (today−2 → +19, week arrows + Today) over a month grid (30 cramped columns) or 1-week (constant paging for 3–7-night stays).
- **Click-only editing in R2**, no drag & drop — dialogs already give every operation; day-granular drag with turnover/blackout rules is a polish slice.
- **Reschedule = new row + `rescheduled`**, same as appointments; not in-place update (history, token semantics, guard reuse).
- **Started stays cannot be moved/rescheduled** (`starts_at > now()`), symmetrical with cancel; "extend a stay in progress" is a later feature.
- **Admin ignores min-notice/booking-window but never turnover/blackouts/unit guard**; no turnover override.
- **Notifications:** dates changed → client "rescheduled" email + provider notice; admin unit-only swap on an `auto` offering → silent; unit-only swap on `client_picks` → email.
- **Folded R1 follow-ups** (cheap, adjacent): engine stops offering today once check-in time has passed; blackout span-cap message reaches the UI; confirmation panel gets a rental what/when block; `<ClientDetailsFields />` extracted.

## Data model + RPCs (migration `0039_rentals_r2_rpcs.sql`)

No new tables/columns.

### Shared helper
```
public.rental_unit_is_free(p_unit_id uuid, p_timezone text, p_range_mode text,
  p_occ_start date, p_occ_end date, p_turnover int, p_exclude_booking_id uuid) returns boolean
```
STABLE, `search_path=''`. True when no `rental_unit_blackouts` row overlaps `daterange(p_occ_start, p_occ_end + p_turnover, '[]')` and no confirmed booking on the unit (other than `p_exclude_booking_id`) whose `daterange(start_date, greatest(start_date, end_date − night_adj) + p_turnover, '[]')` overlaps the same range. This is 0038's inline `not exists` pair, factored out (incl. the `greatest()` clamp); 0038's `create_rental_booking` is rewritten (`create or replace`) to call it — semantics unchanged, pinned by the existing RPC tests. Revoked from all roles; only invoked inside definers.

### `reschedule_rental_booking(p_token text, p_unit_id uuid, p_start_date date, p_end_date date, p_new_token_hash text) returns table(...)`
Anon, definer. Mirrors `reschedule_booking` (0028): token → hash → confirmed rental booking with `starts_at > now()` (else `'not found'`); load org + offering (active); validate exactly as `create_rental_booking` (order per mode, min/max stay, `start >= today+notice`, `end <= today+window`, `v_starts > now()`, `v_ends > v_starts`); `pg_advisory_xact_lock('rental_offering:'||offering)`; **free the old row first** (`status='rescheduled'`); choose unit: `p_unit_id` given → must belong + active + free; null → the **old unit if free, else first free by sort_order/created_at**; none → `'taken'`; insert new row (copies client_id/name/email/note, `rescheduled_from_id = old`, `cancel_token_hash = p_new_token_hash`); returns `booking_id, org_id, org_name, org_timezone, service_name ('offering · unit'), client_name, client_email, old_starts_at, old_ends_at, starts_at, ends_at, unit_changed bool`. Grant execute to anon only.

### `reschedule_rental_booking_admin(p_booking_id uuid, p_unit_id uuid, p_start_date date, p_end_date date, p_new_token_hash text) returns table(...)`
Authenticated, definer; `b.org_id in (select public.user_orgs())` inside; same body **minus notice/window**; same return + `dates_changed bool`. Grant execute to authenticated only.

### `create_rental_booking_admin(p_offering_id uuid, p_unit_id uuid, p_start_date date, p_end_date date, p_name text, p_email text, p_note text, p_token_hash text) returns uuid`
Authenticated, definer; org via `user_orgs()` membership on the offering; validation as the anon RPC minus throttle, notice, window; `v_starts > now()` still required; blackouts/turnover/unit guard via `rental_unit_is_free`; client upsert only when `p_email` non-null (keep-name); insert. Grant execute to authenticated only.

Both reschedule RPCs raise `'started'` (distinct from `'not found'`) when the stay has begun so the UI can say so.

## Engine additions (`src/features/rentals/range.ts`)

- `RangeOffering.startTime?: string` — when present and `now` (org-local) is at/after `startTime` today, `notBefore` becomes tomorrow (unless `minNoticeDays` already pushes it further).
- `RangeInput.ignoreLimits?: boolean` — admin mode: `notBefore = today`, `notAfter = today + 730`.
- `RangeInput.excludeBookingId?: string` on `RangeBooking` (`id` field added) — the booking being moved is skipped when marking occupancy.
- Public/admin loaders (`lib/booking/public.ts`): `loadOrgRangeContext(..., { excludeBookingId })` passes the id through; bookings query returns `id`.

## Timeline

**Route/view:** `/bookings?view=timeline&from=YYYY-MM-DD` — toggle `Week | Timeline | List`; Timeline appears when the org has ≥1 offering. `from` defaults to `today − 2` (org zone); arrows shift ±7 days; "Today" resets.

**Query (RLS client, `src/features/rentals/queries.ts`):** `listTimelineData(fromDate, days = 21)` → `{ offerings: [{ id, name, rangeMode, turnoverDays, units: [{ id, name, active }] }], blackouts, bookings: AdminBooking[] }` — offerings/units: active plus inactive ones that own a booking in the window; blackouts overlapping the window; confirmed rental bookings overlapping `[from, from+21)` (`starts_at < to && ends_at > from`).

**Geometry (`src/features/rentals/timeline-geometry.ts`, pure, tested):**
- `barSpan({ startsAt, endsAt }, mode, tz, windowStart, days) → { colStart, colSpan, halfEnd, clippedLeft, clippedRight } | null` — org-local dates via `dateInZone`; nights: cells check-in..checkout inclusive with `halfEnd = true` (checkout cell drawn half-width, hotel handover); days: pickup..return inclusive, `halfEnd = false`; clipped to the window; `null` when fully outside.
- `turnoverSpan(bar, turnoverDays, days)` → faint tail cells after the last occupied day (checkout day for nights).
- `blackoutSpan(startDate, endDate, windowStart, days)`.

**Component (`src/features/rentals/components/timeline.tsx`, client):** CSS grid `grid-cols-[12rem_repeat(21,minmax(2.25rem,1fr))]`, sticky left column; header row: weekday initial + day number, today column tinted, weekends faint; offering header rows (name, mode badge) then unit rows (name, "inactive" badge); **stay bars** = `<button>` with `borderLeft: serviceAccent(offeringId)`, label = client name (truncate), `title` = range line, `onClick → setSelected(booking)`; **blackout bars** hatched, `title = reason`; **turnover tails** faint hatch, non-interactive; **empty cells** = `<button aria-label="New booking, Flat 2, 20 Aug">` → New rental dialog prefilled; row min-height 2.25rem; horizontal scroll under 840px like the week grid. Selected booking → existing `BookingDetailDialog` (gains **Move…** for rentals).

Not in R2: drag/drop, appointments on the timeline, occupancy stats.

## Admin move / walk-in / client reschedule

**Actions (`src/features/rentals/booking-actions.ts`, "use server", authenticated):**
- `getAdminRangeAvailability({ offeringId, fromDate, days ≤ 93, excludeBookingId? })` → engine with `ignoreLimits`, own booking excluded; returns `availability`, `units`.
- `rescheduleRentalBookingAdmin({ id, unitId | null, startDate, endDate })` → engine pre-check (`validateStay`, ignoreLimits) → mint token → RPC → emails: `dates_changed` → `bookingRescheduledEmail` (range when-lines) + `providerRescheduledEmail`; `unit_changed && !dates_changed` → email only if offering `client_picks`; returns `{ ok, token?, unitChanged, datesChanged, emailed }`.
- `createRentalBookingAdmin({ offeringId, unitId | null, startDate, endDate, name, email?, note? })` → engine pre-check (ignoreLimits) → RPC → confirmation email if email → `{ ok }`.
- `revalidatePath("/bookings")` on success.

**Client (`src/features/rentals/manage-actions.ts`, token-scoped, `tokenLimiter`):**
- `getManageRangeAvailability({ token, fromDate, days })` — resolves token (confirmed rental, future), engine with notice/window, own booking excluded.
- `rescheduleRentalBooking({ token, unitId | null, startDate, endDate })` → engine pre-check → RPC → new token → emails (`bookingRescheduledEmail` to client, `providerRescheduledEmail`) → `{ ok, token }`; UI `router.push('/booking/<new token>')`.

**Dialogs (`src/features/rentals/components/`):**
- `move-rental-dialog.tsx` — range picker (admin availability) + Unit select ("Auto — keep {unit} if free" default, then each unit free for the chosen range from `validateStay(...).unitIds`) + Confirm; conflict → "Those dates were just taken" + refetch; started → "This stay has already started."
- `new-rental-booking-dialog.tsx` — offering select (prefill), unit select (prefill/Auto), range picker (admin availability), `<ClientDetailsFields emailOptional />`; from an empty timeline cell (prefilled unit + start date) and from the list view's New booking, which becomes a small "Appointment / Rental" menu when the org has offerings.
- `booking-detail-dialog.tsx` — **Move…** button for rental bookings (opens the move dialog); appointments unchanged.
- Manage page: `ManageBooking canReschedule` back to true for rentals; rental branch renders `rental-reschedule-panel.tsx` (range picker + optional unit step for `client_picks`).
- `range-picker.tsx` gains `variant?: "widget" | "admin"` (no `wt-*` classes in admin), otherwise unchanged; `<ClientDetailsFields />` extracted to `src/features/scheduling/components/client-details-fields.tsx` and used by the widget flows and both admin dialogs.

## Error handling
- Conflicts anywhere → `DATES_TAKEN` copy + picker reset/refetch (existing pattern).
- RPC `'started'` → "This stay has already started."; `'not found'` → generic; admin unit-only swap on `auto` → success toast "Unit changed (no email sent)".
- Engine and RPC disagree only under races; the RPC + guards win.

## Security
- New authenticated RPCs check org membership inside (`user_orgs()`), not only via RLS.
- Anon reschedule RPC: token-scoped, rotates the token, rate-limited (`tokenLimiter` keyed like appointment reschedule).
- `rental_unit_is_free` has no grants (internal helper).
- No new data collected.

## Testing
- Unit: `timeline-geometry.test.ts` (nights half-end, days full, clipping both edges, turnover tail, DST-crossing stay), `range.test.ts` additions (`startTime` rollover; `ignoreLimits`; `excludeBookingId`), `client-details-fields` untouched by vitest (no component infra), schema tests for new inputs.
- Integration (`src/features/rentals/r2-rpc.integration.test.ts`): reschedule dates-only keeps unit; unit swap keeps dates; shift shorter than the stay doesn't self-conflict; started stay → `'started'`; token rotation (old dead, new resolves); admin variant `unit_changed`/`dates_changed`; admin create without email, ignoring notice/window, refusing blackout/turnover; `rental_unit_is_free` parity (0038 tests still pass).
- Flow (`flow.integration.test.ts` extended): book → client reschedule → new token resolves + old 404 → availability reflects the move.
- Manual: timeline renders bars/blackouts/tails; empty-cell walk-in; Move dialog auto/pick; list menu; manage-page reschedule; Mailpit emails.

## Out of scope
Drag & drop; org mode flags / onboarding / vocabulary (next slice); extending in-progress stays; turnover override; occupancy stats; hourly rentals; pricing.
