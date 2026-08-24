# H2 — Hourly Mode (resource-booking pivot, slice 2)

**Date:** 2026-08-24
**Status:** Approved (brainstorm with Andrii)
**Parent:** `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md` (§Architecture, roadmap row H2)
**Depends on:** H1 org modes (merged, PR #54)

## Decision

`range_mode` gains a third value, **`hours`**: rental offerings whose units are
booked by the hour on an increment grid, powered by the **existing DST-safe
appointments slot engine** (`src/features/scheduling/slots.ts`) — no new
engine, no new booking columns for the hourly case. Opening hours live on the
existing `availability_rules`/`availability_exceptions` tables via a new
`rental_offering_id` owner. Hourly bookings render on the week calendar like
appointments; the R2 timeline stays nights/days-only.

Rulings from this brainstorm:

1. **Full admin parity in H2** — walk-in creation *and* move/reschedule for
   hourly bookings (the target buyer takes most bookings via Messenger/phone).
2. **Client self-reschedule: yes, same duration** — new start time on the
   grid, length unchanged; changing duration = cancel + rebook.
3. **Generalize the seam** — the availability editor (components + server
   actions) and the public time-grid picker take a typed owner / fetch-action
   parameter and are shared between staff and offerings, rather than copied
   into the rentals feature.

## Migrations: 0055 + 0056 (renumber note)

Repo convention is a generated Drizzle migration plus a custom security SQL
migration (0037+0038, 0053+0054). H2 therefore takes **0055 (generated) +
0056 (custom)** — the roadmap table's later rows shift by one again:
H3 → 0057, H4 → 0058.

## Data model

### `rental_offerings`

- `range_mode` CHECK extends to `('nights','days','hours')`.
- New columns (all hours-mode-only):
  - `slot_increment_min int` — start-time grid step.
  - `min_duration_min int`, `max_duration_min int` — client-pickable length
    bounds. **`max_duration_min` is required for hours mode** (unlike
    `max_stay`) — the duration picker needs a bounded option list.
  - CHECK: min/max are multiples of the increment, `max >= min`, and all
    three NOT NULL iff `range_mode = 'hours'` (NULL otherwise).
  - `turnover_min int not null default 0` — hourly cleanup gap.
    `turnover_days` stays for nights/days.
  - `min_notice_min int not null default 0` — mirrors
    `services.min_notice_min`; days-granularity notice can't express
    "2 h ahead", which is the normal case for a studio.
- `start_time`/`end_time` become **nullable** with a per-mode CHECK
  (`hours` ⇒ NULL — opening hours come from availability rules; nights/days ⇒
  NOT NULL as today).
- `min_stay`/`max_stay`/`turnover_days`/`min_notice_days` keep their defaults
  on hours rows and are documented-ignored (no CHECK churn).

### `availability_rules` / `availability_exceptions`

- `staff_id` drops the 0041 NOT NULL; new
  `rental_offering_id uuid references rental_offerings on delete cascade`.
- CHECK exactly-one-of: `(staff_id is not null) <> (rental_offering_id is not
  null)` (the `bookings_kind` idiom from 0037).
- **Overlap-guard twins:** EXCLUDE constraints never fire on NULL keys, so
  the 0035/0041 staff-keyed overlap guards silently ignore offering rows.
  0056 adds offering-keyed EXCLUDE twins (same immutable-helper/int4range
  shape as 0035) for both tables.
- Org-consistency trigger (`check_rental_unit_org` idiom): the offering must
  belong to `new.org_id`.
- Indexes on `(rental_offering_id, weekday)` / `(rental_offering_id, date)`;
  column-scoped grant extensions per the supabase-grants convention.

Hours are **offering-level only** ("both studios open Mon–Sat 9–21");
per-unit overrides stay deliberately excluded (parent spec).

### Bookings: nothing new

`bookings.starts_at/ends_at` are already `timestamptz` and rentals already
write them. The **existing** `bookings_rental_unit_no_overlap` EXCLUDE
(0037, per-unit tstzrange on confirmed rows) is the race backstop — 0056
touches no bookings constraints. (`pending_payment` hold coverage is H4.)

## Engine mapping

No changes to `slots.ts`. An hourly offering builds `SlotInput` per unit:

| field | source |
|---|---|
| `durationMin` | client-chosen (validated: on the increment grid, within min/max) |
| `bufferBeforeMin` | 0 |
| `bufferAfterMin` | `turnover_min` (candidate and busy-side — the 2026-08-24 audit fix pads both) |
| `minNoticeMin` / `bookingWindowDays` | `min_notice_min` / `booking_window_days` |
| `maxPerDay` | null |
| `rules` / `exceptions` | offering-scoped availability rows |
| `busy` | the unit's confirmed bookings + its `rental_unit_blackouts` converted to whole-day busy intervals via org tz |
| `timeZone` / `now` | org tz / injected |

Start times anchor at each opening window's start, stepping by the increment.
**Units:** slots computed per unit; `auto` unions free-unit start times and
the create RPC picks a unit (0039 idiom); `client_picks` scopes to the chosen
unit. R1 `unit_selection` semantics unchanged.

## RPC surface (0056, all service_role-only — 0052 posture)

- `create_rental_booking_hours(...)` — body mirrors `create_booking` v4:
  offering active + hours mode, duration on grid, availability containment
  re-checked in-RPC, unit freeness via a new tstzrange helper with turnover
  padding (hourly sibling of `rental_unit_is_free`), auto unit pick, manage
  token hash, reminder fields. EXCLUDE constraint as final backstop.
- `create_rental_booking_hours_admin(...)` — walk-in variant: nullable email,
  R2 `ignoreLimits` posture (past notice/window, never past occupancy).
- `reschedule_rental_hours_apply(...)` — private core (old row →
  `rescheduled` **before** the new insert, token rotation — R2 idiom), with
  an anon manage-token wrapper (limits enforced) and an admin wrapper
  (`ignoreLimits`, unit change allowed, auto prefers the old unit, **no
  provider notice on admin moves** — R2 ruling).

## Admin surfaces

- **Offering form** discriminates on range mode: *Hours* shows increment,
  min–max duration, turnover (minutes), min notice; hides check-in/out and
  stay/turnover-days fields. Zod schema discriminated on `rangeMode`.
- **Opening hours editor:** the offering edit page mounts the *same*
  weekly-hours + date-overrides editor as `/availability`; editor components
  and replace-rules/replace-exceptions actions take a typed owner
  (staff XOR offering); the offering path authorizes offering ∈ `currentOrg()`.
- **Week calendar:** hourly bookings render as timed events
  (offering · unit · client). Hidden when the calendar is filtered to a
  specific staff member (a room isn't that person's work); shown in the
  everyone view. `getBusyIntervals` keeps excluding rentals (R1 ruling).
- **Walk-in dialog** (R2) gains an hours branch: offering → duration →
  day + time grid → unit, via the admin RPC.
- **Move dialog** (R2) gains an hours branch: same-duration time grid.
  Known R2 wart (no-op move silently rotates the client link) is inherited,
  not fixed here.
- **Timeline:** hourly offerings do not appear; nights/days unchanged.

### R2 deferrals folded in (parent-spec commitment)

1. `listTimelineData` window padded by turnover (+ first integration test).
2. Request-ordering guard (house pattern) in the three rental pickers; the
   new hourly pickers ship with it from day one.

## Public flow

- **Catalog:** `listPublicCatalog` (H1 choke point) already carries rental
  offerings to `/book/[handle]`, `/{handle}`, and the embed. Hourly cards
  show the duration range ("1–8 h") + free-text `price_label` (until H3).
  All gating via `effectiveMode()` — never hand-written flag × mode logic.
- **Flow:** duration picker (pills; a select when the grid yields many
  options) → day strip + time grid reusing the appointment picker components
  via the parameterized fetch-slots seam → name/email/note → confirmation.
- **`getHourlySlots(handle, offeringId, durationMin, from, days)`** public
  server action: `publicBookingLimiter`, mode-gated (answers null for an off
  channel — H1 idiom), request-ordering guard.
- **Embed:** the time grid must not permanently grow the iframe (S3
  height-ratchet lesson).
- **Manage page:** hourly rows show the time range; cancel unchanged;
  reschedule = same-duration time grid via the anon wrapper; client limits
  enforced; provider notice on client reschedule; token rotates.
- **Emails/reminders:** rental confirmation/manage/reminder copy gains
  time-of-day formatting (org tz) for hourly rows; the reminder drain is
  untouched — hourly bookings ride the same `starts_at` scan.

## Testing

- Engine unit tests: increment anchoring at window start, variable duration,
  DST spring-forward day, busy-side turnover padding, blackout→busy
  conversion.
- RPC integration tests (serial files per convention): containment re-check,
  EXCLUDE race backstop, auto unit pick, admin `ignoreLimits`, reschedule
  rotation + old-row status, mode gating.
- Component test: duration picker. One public hourly e2e happy path.
- Seed: an hourly demo offering (2 units, Mon–Sat opening hours) — also the
  H5 screenshot material.

## Rollout

No new flags — the rentals kill-switch + H1 org modes already gate
everything. 0055/0056 are backward-compatible (new nullable/defaulted
columns; the XOR CHECK is satisfied by existing staff-keyed rows): standard
migrate-then-deploy order.

## Out of scope

Prices/terms (H3, 0057), deposits/holds/`pending_payment` (H4, 0058), pooled
capacity, per-unit opening hours, dynamic pricing, hourly timeline, GCal for
resources, SMS.
