# Rentals — Slice R1 (unit inventory, date-range bookings, public range flow)

**Date:** 2026-08-17
**Status:** Approved (brainstorm with Andrii)
**Parent:** `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md` — this extends the scheduling product from "appointments only" to "appointments + rentals" without a second subsystem.
**Base:** `main` @ `4a41b30` (availability editor #30 merged; last migration `0035`).

## Decision

Booklo covers both **appointment** businesses (Calendly-style, freelancers, salons) and **rental** businesses (cars, flats, rooms, equipment). Both share one core — `bookings`, `clients`, manage links, emails, reminders, ICS, cancel flow, widget theming/embed, RLS conventions — and differ in *how time is sold*:

| | Appointment (exists) | Rental (this slice) |
|---|---|---|
| Sold as | `services` — N-minute slots on the provider's calendar | `rental_offerings` — nights or days on a physical **unit** |
| Availability | weekly rules + date overrides (org-level) | per-unit blackouts + occupied ranges |
| Booking shape | `starts_at/ends_at`, capacity 1 per org | same columns, capacity 1 **per unit** |
| Guard | tstzrange EXCLUDE per org | tstzrange EXCLUDE per unit |
| Client picks | date → time slot | date range → (unit) |

Decisions made during brainstorm (with rejected alternatives):

1. **One core, mode-tuned UX** — not a parallel "rentals" product. Rejected: two subsystems (duplicated lifecycle code), and retrofitting `services` with rental columns (a table of contradictory CHECKs).
2. **Named units + auto-assignment**, not pooled capacity. Every physical thing is a `rental_units` row; a booking is pinned to exactly one unit; a "car class" is an offering with 3 unit rows. Reuses the EXCLUDE guard verbatim. Pooled capacity (`capacity: N`, count-overlap check) can be added later as an offering without units if a real customer needs it.
3. **Nightly + daily in R1; hourly rentals later.** Hourly is today's slot engine with a resource attached — falls out of a later slice, not designed here.
4. **Unit selection per offering: `auto` | `client_picks`** — cars → auto, flats → client picks. Units carry only name + description in R1 (no per-unit photos/pricing).
5. **Org mode: hard mode by default + "enable both" toggle** (`offers_appointments` / `offers_rentals` booleans set at onboarding). **Deferred to R2**; R1 shows "Rentals" in nav for everyone.
6. **Additive schema, no refactor of appointments** — `bookings` gains nullable rental columns; services/availability/`computeSlots` untouched. Rejected: unifying appointments under an implicit "provider resource" now — wide migration for no user-visible gain, and it was designing for multi-staff rather than rentals.

## Slice roadmap

| Slice | Contents |
|---|---|
| **R1 (this spec)** | Schema + guard + RPC, range engine, admin CRUD (offerings, units, blackouts), public range flow, emails/ICS/reminders adapted, minimal calendar + bookings-list rendering |
| **R2** | Unit timeline calendar (rows = units, bars = bookings; move/pin bookings), rental reschedule (client + admin), onboarding "What are you booking?", `offers_*` mode flags, mode-aware nav/vocabulary/empty states, "enable both" toggle |
| **R3+** | Hourly rentals (service ↔ unit), per-night/seasonal pricing, deposits (with Stripe slice), pooled capacity, per-unit photos, multi-staff appointments |

## Data model

New Drizzle file `src/db/schema/rentals.ts`; a generated migration `0036_*` for the tables/columns, then two custom SQL migrations — `0037_rentals_security.sql` (CHECKs, RLS, GRANTs, guards, trigger, resolver/cancel RPC updates) and `0038_create_rental_booking.sql` (the RPC) — the 0026 idiom: security surface in reviewable custom files. Explicit GRANTs on every new table (repo convention).

### `rental_offerings`
| column | type / rule |
|---|---|
| `id` | uuid pk |
| `org_id` | → orgs, cascade |
| `name` | text, 1–200 |
| `description` | text null, ≤ 2000 |
| `price_label` | text null (free text, as `services.price_label`) |
| `range_mode` | text, CHECK in (`nights`, `days`) |
| `start_time`, `end_time` | text "HH:MM" org-local (format CHECK as `availability_rules`); check-in/check-out for `nights`, pickup/return for `days` |
| `min_stay` | int, default 1, CHECK ≥ 1 (unit = nights or days per mode) |
| `max_stay` | int null, CHECK null or ≥ min_stay |
| `turnover_days` | int, default 0, CHECK 0..30 |
| `min_notice_days` | int, default 0, CHECK 0..365 |
| `booking_window_days` | int, default 180, CHECK 1..730 |
| `unit_selection` | text, CHECK in (`auto`, `client_picks`), default `auto` |
| `active` | bool default true |
| `sort_order` | int default 0 |
| `created_at` | timestamptz |

Index: `(org_id)`.

### `rental_units`
(Named `rental_units`, not `units` — the legacy fire-safety schema already owns `units`.)

`id`, `org_id` (→ orgs cascade), `offering_id` (→ rental_offerings cascade), `name` (1–200), `description` (null, ≤ 2000), `active` bool, `sort_order` int, `created_at`. Index `(offering_id)`, `(org_id)`.

### `rental_unit_blackouts`
`id`, `org_id`, `rental_unit_id` (→ units cascade), `start_date` date, `end_date` date (both org-local, **inclusive**; CHECK `end_date >= start_date`), `reason` text null (≤ 500), `created_at`. Index `(rental_unit_id, start_date)`.

### `bookings` (additive)
- `+ rental_offering_id uuid null` → rental_offerings **restrict**
- `+ rental_unit_id uuid null` → units **restrict**
- `service_id` becomes **nullable**
- CHECK `bookings_kind`: `(service_id is not null) <> (rental_offering_id is not null)`
- CHECK `bookings_unit_iff_rental`: `(rental_unit_id is not null) = (rental_offering_id is not null)`
- Existing `bookings_no_overlap` is **recreated** with `where (status = 'confirmed' and rental_unit_id is null)` — appointments only.
- New `bookings_rental_unit_no_overlap`: `exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'confirmed' and rental_unit_id is not null)`.
- Index `(rental_unit_id, starts_at)`.
- Turnover is an engine/RPC concern (like buffers for appointments); the constraint guards the physical stay.

`starts_at/ends_at` for rentals = `start_date + start_time` → `end_date + end_time`, computed in the org's timezone (checkout day for `nights`, return day for `days`). The `tstzrange` therefore remains a truthful "physically occupied" interval and every downstream consumer (calendar, reminders, ICS, manage page, stats) works unchanged.

Existing rows: all have `service_id`, `rental_unit_id` null → both CHECKs hold; the recreated appointment guard is equivalent for them.

### RLS / grants
- `rental_offerings`, `rental_units`, `rental_unit_blackouts`: org-member `select/insert/update/delete` via the established `org_id in (select public.user_orgs())` policy pattern (0026); explicit GRANTs to `authenticated`. **No anon policies** — the public page reads through the admin client scoped by resolved handle (`lib/booking/public.ts` precedent, S3 decision), and writes only through the definer RPC.
- `bookings` policies unchanged; the new columns are covered by the existing row policies. `create_rental_booking` is the only rental write path for anon.

### RPC `create_rental_booking`
```
create_rental_booking(p_handle text, p_offering_id uuid, p_unit_id uuid /*null = auto*/,
                      p_start_date date, p_end_date date,
                      p_name text, p_email text, p_note text, p_token_hash text) returns uuid
```
Definer, `search_path=''`, `execute` granted to `anon` only (revoke from all others), mirroring `create_booking`. Steps:
1. Resolve org by handle; offering by id+org+active; else `'not found'`.
2. Validate name/email/note/token_hash exactly as `create_booking` (same regexes/lengths).
3. Validate dates: `start_date >= today_in_org_tz + min_notice_days`; `end_date > start_date` (`nights`) / `end_date >= start_date` (`days`); stay length within `min_stay..max_stay`; `end_date <= today + booking_window_days`.
4. Compute `v_starts := (start_date + start_time) at time zone org.timezone`, `v_ends := (end_date + end_time) at time zone org.timezone`.
5. Candidate units: active units of the offering, ordered by `sort_order, created_at`; if `p_unit_id` given, only that one (must belong to offering + be active).
6. For each candidate, "free" means: no `rental_unit_blackouts` row with `daterange(start_date, end_date, '[]')` overlapping the **occupied date range** (see engine semantics below, incl. turnover), and no confirmed booking on that unit whose stay-plus-turnover overlaps the requested stay-plus-turnover. Pick the first free unit; none → raise `'taken'`.
7. Upsert client by `(org_id, lower(email))` — same keep-name semantics as 0034.
8. Insert booking with `rental_offering_id`, `rental_unit_id`, `v_starts/v_ends`, `status='confirmed'`, `cancel_token_hash`, note. The EXCLUDE guard is the last line against a race; unique-violation/exclusion → the action maps to "those dates were just taken" and refetches availability. Auto mode: the server action retries the RPC once on exclusion (the RPC re-picks the next free unit).

Statement-level: candidate scan + insert run in the same statement, so a losing race hits `bookings_rental_unit_no_overlap`, never a silent double-assignment.

## Range availability engine

Pure, DB-free module `src/features/rentals/range.ts` (+ `range.test.ts`), sibling of `slots.ts`.

```ts
computeRangeAvailability({
  offering,          // rangeMode, minStay, maxStay, turnoverDays, minNoticeDays, bookingWindowDays
  units,             // active units (id, sortOrder)
  blackouts,         // {unitId, startDate, endDate}
  bookings,          // confirmed, for these units, in window: {unitId, startsAt, endsAt}
  timeZone, now, fromDate, days,
}) → { dates: Record<ISODate, { free: number; unitIds: string[] }> }
```

**Occupancy semantics (dates, org-local):**
- A booking occupies unit `U` on dates `[startDate, endDate)` for `nights` (checkout day is free for a new check-in — hotel semantics), `[startDate, endDate]` for `days` (return day is taken), **plus** `turnover_days` after the last occupied date.
- Blackouts occupy `[start_date, end_date]` inclusive.
- Booking `startDate/endDate` are derived from `startsAt/endsAt` via `dateInZone(timeZone)` (reused from `slots.ts`).
- Date is *unavailable* if before `today + min_notice_days` or after `today + booking_window_days`.
- `free` = count of units not occupied on that date; `unitIds` = which.

**`validateStay(offering, availability, startDate, endDate) → { ok: true; unitIds } | { ok: false; reason }`** — pure helper: nights → every night in `[start, end)` free on the *same* unit; days → every day in `[start, end]`. Enforces `min_stay/max_stay` and mode-specific `end > start` / `end >= start`. Used by the picker (disable invalid end dates after start is chosen), by the server action before the RPC (friendly errors), and its rules are mirrored in SQL by the RPC (truth).

Public server action `getRangeAvailability({ handle, offeringId, fromDate, days })` — zod-validated, rate-limited via `publicBookingLimiter`, loads context through a new `loadOrgRangeContext` in `lib/booking/public.ts` (admin client: offering, active units, blackouts, confirmed bookings in window ± turnover), returns the engine output. `days` capped at 62 (two months) like `getSlots` caps its window.

## Admin (R1)

Feature module `src/features/rentals/` mirroring `features/scheduling`: `schema.ts` (zod), `actions.ts`, `queries.ts`, `components/`. Routes under `src/app/(dashboard)/rentals/`.

- **`/rentals`** — offerings list. Card per offering: name, mode badge ("Nightly" / "Daily"), unit count, price label, active toggle, no drag-ordering in R1 (`sort_order` stored, insertion order shown — `services-list` has no reorder either). Create/edit dialog (`offering-dialog.tsx`, modeled on `service-dialog.tsx`) with fields grouped: *Basics* (name, description, price label) · *Stay* (mode, start/end time via `time-options.ts`, min/max stay, turnover days) · *Booking* (notice days, window days, unit selection).
- **`/rentals/[id]`** — units for one offering: inline list (add / rename / description / active / delete) and, per unit, blackouts (add date range + optional reason, list, delete). Form-heavy page, no calendar.
- **Bookings list** (`bookings-list.tsx`) and **detail dialog**: rental rows show "{offering} · {unit} · N nights|days" and a date-range "when" line (`12 Sep → 15 Sep`) instead of service + time. Cancel unchanged. **Reschedule hidden for rental bookings** (R2 with the timeline).
- **Week calendar** (`calendar-week.tsx`): rental bookings render as all-day bars in the day-header row spanning their dates (the hourly grid cannot host a 3-night stay). Click opens the same detail dialog. Walk-in creation for rentals: not in R1 (admin uses the public page or R2 timeline).
- **Nav**: "Rentals" item added (icon: key/building), visible to all orgs in R1.
- **Onboarding, settings, overview stats**: untouched (overview counts include rental bookings automatically since they are `bookings` rows).

Actions (authenticated client + RLS, zod-validated, `ActionState` idiom, `revalidatePath`):
`createOffering / updateOffering / deleteOffering`, `createUnit / updateUnit / deleteUnit`, `addBlackout / deleteBlackout`. Delete of an offering/unit with any booking (any status) fails via FK **restrict** → action returns "Deactivate instead — it has bookings"; the UI offers the active toggle. Blackouts may be added retroactively over existing bookings (owner's call; no validation against bookings).

Sidebar/nav vocabulary and mode gating are explicitly R2.

## Public booking flow (`/book/[handle]`)

- **Landing**: if the org has ≥1 active offering with ≥1 active unit, the page shows two sections — "Appointments" (existing service cards) and "Stays & rentals" (offering cards: name, description, price label, "min N nights/days" when `min_stay > 1`). When only one kind exists, no section headers (visually identical to today). Embed mode unchanged; existing `?embed=1` + resize reporter cover new steps.
- **Range picker** (`range-picker.tsx`, sibling of the slot picker inside `booking-widget.tsx`): month calendar (two months on wide screens), navigable within the booking window; days with `free = 0`, before notice, or beyond the window are disabled. Click 1 sets check-in/pickup; then `validateStay` disables end dates that would fail (blocked date on every unit between, min/max stay, mode rule); click 2 sets end. Summary line: "3 nights · check-in 15:00 · check-out 11:00 (Europe/Berlin)". **No browser-timezone conversion for rentals** — stays are place-bound; dates + org-local times only (differs from appointment slots on purpose).
- **Unit step** — only when `unit_selection = 'client_picks'`: free units for the chosen range as radio cards (name, description); default first. Skipped for `auto`.
- **Details** — same name/email/note form; submit → `createRentalBooking` server action (rate-limited, zod, calls `validateStay` on fresh data for a friendly error, then the RPC). Conflict → "Those dates were just taken — please pick again", availability refetched, picker reset. Auto mode retries once before surfacing.
- **Confirmation screen** — reuses the existing confirmation panel with a rental "what/when" block. Manage link identical.
- **Emails** — `bookingConfirmationEmail` / reminder / cancellation templates gain a rental variant of the "when" line: "{offering} · {unit} · Fri 12 Sep 15:00 → Mon 15 Sep 11:00 (Europe/Berlin)". `formatWhenLine` gets a rental branch keyed on `rental_unit_id`. ICS: single event with the real check-in/out instants (not `VALUE=DATE` all-day; the instants are correct and calendar apps render multi-day bars fine).
- **Manage page `/booking/[token]`** — rental details rendered; **Cancel** as-is (status flip, both parties emailed); **Reschedule** hidden for rental bookings in R1.
- **Reminders** — the existing 24h drain selects by `starts_at`; rental bookings are picked up automatically; template uses the rental when-line.
- **Widget theming / live preview** — new components consume the same CSS variables; the widget preview shows the rental section when the org has offerings.

## Error handling

- All new public actions: zod → `GENERIC_WRITE_ERROR`; rate-limit → same message as `getSlots`; RPC `'not found'` → generic; RPC `'taken'` / exclusion violation → "Those dates were just taken — please pick again."
- Admin actions: FK-restrict on delete → explicit "has bookings, deactivate instead"; everything else → `ActionState` error idiom.
- Engine and RPC disagree only under races; the RPC/constraint win and the UI refetches.

## Security

- No new anon table grants; the RPC is the only anon write path and validates every input server-side (dates, stay bounds, unit ownership, active flags), never trusting the engine.
- Manage tokens: unchanged mint/hash flow — rentals reuse `cancel_token_hash`.
- Data collected: still name, email, optional note (solo-operator constraint holds; no ID numbers, addresses, or payment data).
- RLS tests for the three new tables (as in prior slices), including that anon has no read/write on them.

## Testing

- `range.test.ts`: nights vs days occupancy, checkout-day-free rule, turnover, blackouts, min/max stay, notice + window edges, DST-crossing stays (dates derived via `dateInZone`), multi-unit `free` counts, `validateStay` same-unit requirement (two units each partially free must NOT validate).
- DB tests (existing pg test harness): both EXCLUDE guards (appointment guard ignores rental rows and vice-versa), `bookings_kind` CHECK, RPC happy path for `auto` and `client_picks`, RPC rejects notice/window/stay violations, blackout and turnover conflicts, and a **concurrent double-book on the last free unit** (one wins, one gets `'taken'`/exclusion).
- RLS tests for `rental_offerings`, `rental_units`, `rental_unit_blackouts`.
- Component tests: range picker disable logic (given availability + selected start), unit step visibility per `unit_selection`.
- One e2e: create offering + 2 units → public range booking (auto) → confirmation → cancel via manage link.

## Out of scope (R1)

Rental reschedule (client/admin), unit timeline calendar, admin walk-in rental creation, mode flags/onboarding/vocabulary, hourly rentals, pricing math/seasonal rates/deposits, pooled capacity, per-unit photos, per-weekday check-in restrictions, Google Calendar sync for rentals.
