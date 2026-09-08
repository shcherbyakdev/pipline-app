# S6 — Compound resources

Date: 2026-09-08. Roadmap slice S6 (`2026-09-07-studio-ops-roadmap-design.md`; order fixed by `2026-09-07-d1-decision.md` §5: S1 → S2 → S3 → S7 → S4 → **S6** → S8). Builds on the rentals unit model (0037/0038), hours mode (0055/0056), S1 pricing lines (0078), S2 holds (0079) and S3 reschedule (0081). Design approved in chat 2026-09-08 (three choices and the rulings below).

## Goal

One booking can occupy **several units at once**, and the database refuses every overlap on every one of them. Two shapes, both hours mode:

- **Whole studio** — a space that *includes* other rooms. Booking it blocks every room it includes; booking any of those rooms blocks it. Fly Studio's "whole studio (individual)" and MILK's four rooms + make-up room are this shape (`2026-09-07-studio-list.md`).
- **Shared equipment** — an ARRI lamp, a smoke machine, a projector: a space whose units are the physical items. A client adds one to a room booking; that item is then unavailable to every other room for the same hours. Twenty-five of the forty listed studios sell one of these two combinations.

Today `bookings.rental_unit_id` is one unit and the EXCLUDE on it is the only guard. Postgres can only exclude row against row, so a compound booking needs **one occupancy row per unit** somewhere. Everything below follows from that.

## Choices (2026-09-08)

1. **Whole-studio composites + shared equipment.** Rejected: composites only (a shared lamp could still be double-booked, and equipment is the more common combination on the list); ad-hoc multi-room ticking in the widget ("Room A + make-up" is a composite the studio defines once).
2. **Equipment carries its own price and is offered on every hourly room.** Per hour or flat per booking, the existing H3 fields. Rejected: a per-room allowlist (settings UI for a case no listed studio has); pricing equipment inside each room's S1 extras (the lamp's price repeated per room).
3. **A trigger-maintained `booking_units` table with its own EXCLUDE.** Rejected: shadow child bookings (38 files read `bookings`; every list, digest, mail and sync would need a parent filter); unit-id arrays with app-level checks (no gist exclusion over uuid arrays, and the concept brief sells "enforced in the database").

## Rulings

4. **`bookings.rental_unit_id` stays the primary unit.** Every display surface (title, mails, calendar sync, daily list, digest, detail dialog) keeps reading it. `booking_units` is the *occupancy* record; only availability reads and the timeline switch to it.
5. **The booked space's policy governs the whole booking.** Approval, deposit, hold, cancel tiers, terms, opening hours and S1 rules come from the primary offering. Equipment has none of its own and is never the primary. A composite is a full hourly space with its own price, rules and hours.
6. **A composite has exactly one unit, its own, and is never split.** The unit exists for `bookings_unit_iff_rental` and for "two whole-studio bookings cannot overlap". `unit_selection` is forced to `auto` for composites and equipment.
7. **A composite blocks every unit of every included room**, active or not, at insert time. A unit added to an included room *after* a whole-studio booking exists is not retro-blocked (stated ceiling, see Deferred).
8. **Composites and equipment are hours mode only.** Dates-mode rooms cannot be included and cannot attach equipment. Studios are hourly; the CHECK says so instead of a code path saying so.
9. **Equipment is invisible on the public side except as an add-on.** Not in the catalogue, the hosted page, any widget template or `listPublicOfferings`. The hourly flow's add-on step lists it beside the S1 extras with what is free for the chosen slot.
10. **Race handling is the EXCLUDE, as today.** No extra advisory locks for equipment (it has no turnover, so the per-offering lock's reason does not apply). A lost race raises 23P01, which every rentals action already maps to the client's "just taken" message.
11. **Reschedule carries the equipment and may refuse.** S1's degrade-never-refuse rule covers *money*: a deleted or inactive equipment space drops out of the lines. Occupancy is physical: if no unit of an attached equipment space is free at the new time the move fails with `taken`, like a room would. The reschedule panels compute slots with the attached equipment's busy time folded in, so the client rarely reaches that refusal.
12. **Turnover is the checking offering's.** The free-check applies the offering-under-test's turnover to every unit in scope, including component units of other rooms (today's rule, widened). Equipment has `turnover_min = 0`.
13. **Space cap unchanged.** Composites and equipment count toward the Free/Pro shared-resource budget like any space; no gate change.
14. **One-window deploy.** The two hours create RPCs change signature (old ones dropped), as in S1 (`2026-09-07-s1-pricing-rules-design.md`). CD already runs migrate → promote in one pass.

## What exists and is reused

- **Units and offerings** — `rental_offerings`, `rental_units` (`src/db/schema/rentals.ts`); every space is born with one unit (PR #70/#114, `withUnit` in `src/features/rentals/unit-label.ts`: the unit word appears only at 2+ units); `unit_selection` auto/client_picks; `OFFERING_DEFAULTS`, `offeringInput = z.union([rangeOffering, hoursOffering])`, `unitInput` (`src/features/rentals/schema.ts`); `createOffering`/`updateOffering`/`patchOffering`, `createUnit`/`updateUnit`/`deleteUnit` (`src/features/rentals/actions.ts`); `OfferingForm` (`components/offering-form.tsx`, `rangeMode` state branches the form), `UnitsEditor`, `SpaceHeader`, `OfferingsList`; routes `/rentals`, `/rentals/new`, `/rentals/[id]`.
- **Guards** — `bookings_rental_unit_no_overlap` (0079: `status in ('confirmed','pending','pending_payment')`), `check_rental_unit_org` trigger idiom (0037), `rental_unit_is_free(unit, tz, start_date, end_date, turnover_days, exclude)` and `rental_unit_is_free_hours(unit, tz, starts, ends, turnover_min, exclude)` (0079), `pg_advisory_xact_lock(hashtext('rental_offering:'||id))` in every create RPC.
- **RPCs** — `create_rental_booking_hours(handle, offering, unit, starts, duration, name, email, note, token_hash, people, extras)` (0079), `create_rental_booking_hours_admin(…, people, extras)` (0078), `reschedule_rental_hours_apply(old, unit, starts, token_hash, enforce)` (0081: flips the old row to `rescheduled` **before** the free-check and the insert — the trigger below relies on that order), `create_rental_booking`/`reschedule_rental_apply` (dates), `rental_quote_hours(offering, starts, duration, people, extras) → jsonb lines` with sentinels `quote_band|quote_people|quote_extra`, `rental_lines_total`, `rental_deposit_cents`, `rental_total_cents` (0078).
- **Lines** — `Line` union + `pricingRulesSchema`, `ExtraPick` (`src/features/rentals/pricing-rules.ts`); TS twin `quoteHours` (`pricing.ts`, per-hour rounding `Math.round(perHourCents * durationMin / 60)` ≡ SQL `round(v_unit * v_hours)::int`), parity fixtures `pricing-quote.integration.test.ts`; `moneyInfoLines`, `BookingMoneySummary` render any line by `kind`/`label`.
- **Availability reads** — `loadOrgHourlyContext` (`src/lib/booking/public.ts:765`, per-unit busy from `bookings`), `loadOrgRangeContext` (`:638`), `blackoutBusy`/`unionUnitSlots` (`hourly.ts`), `externalBusy` (Google Busy blocks every unit), `getAdminHourlySlots`/`createRentalBookingHoursAdmin`/`rescheduleRentalHoursAdmin` (`booking-actions.ts`), `rescheduleRentalBookingHours` + `isTaken(error) = isRpcSentinel(error,"taken") || error.code === "23P01"` (`manage-actions.ts:86`, twin at `booking-actions.ts:108`).
- **Widget** — `HourlyBookingFlow` (`components/hourly-booking-flow.tsx`: slot → duration → people/extras rows → confirm; `quoteHours` re-runs on every change), `HourlyReschedulePanel`, `PublicOffering`/`HourlyOffering` (`public.ts`, `hourly.ts`), `PUBLIC_OFFERING_COLUMNS`.
- **Timeline** — `listTimelineData` (`queries.ts:266`, one `bookings` select placed on the lane of `rentalUnitId`), `TimelineLane`, `toAdminBooking`/`BOOKING_COLUMNS`.
- **i18n** — `messages/{en,pl,uk}.json`, `messages.test.ts` refuses partial locales; `rentals.*`, `public.*` namespaces.
- **Tests** — `*.integration.test.ts` against local Supabase (`npm run test:integration`), rentals fixtures pass explicit org flags (`one-channel-per-org-notes`); scripted Playwright QA from the npx cache.

## Data model (migration `0084_compound_resources`)

### `rental_offerings`

- `kind text not null default 'space'`, CHECK `kind in ('space','composite','equipment')`.
- CHECK `rental_offerings_compound_hours`: `kind = 'space' or (range_mode = 'hours' and unit_selection = 'auto')`.
- No further CHECKs on equipment's unused policy columns; the form does not expose them and equipment is never the primary offering (ruling 5).

### `rental_offering_components`

| column | type | notes |
|---|---|---|
| `composite_id` | uuid FK `rental_offerings` cascade | the whole studio |
| `component_id` | uuid FK `rental_offerings` cascade | an included room |
| `org_id` | uuid FK `orgs` cascade | denormalised for RLS |
| PK | `(composite_id, component_id)` | |

BEFORE INSERT OR UPDATE trigger `check_offering_component()` (0037 idiom): both offerings exist in `org_id`; composite `kind = 'composite'`; component `kind = 'space'` and `range_mode = 'hours'`; `composite_id <> component_id`. Nesting is impossible by the kind rule. RLS: members of `org_id` (`user_orgs()`) select/insert/delete; explicit GRANTs (`supabase-grants-convention`).

### `booking_units`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK `orgs` cascade | |
| `booking_id` | uuid FK `bookings` cascade | |
| `rental_unit_id` | uuid FK `rental_units` cascade | history of a deleted room's component rows goes with the room; the primary FK on `bookings` still restricts |
| `kind` | text | CHECK `in ('primary','component','equipment')` |
| `starts_at`, `ends_at` | timestamptz | copied from the booking; CHECK `ends_at > starts_at` |
| `reserving` | boolean not null | `= status in ('confirmed','pending','pending_payment')`, trigger-maintained |

- `booking_units_no_overlap exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&) where (reserving)`.
- `unique (booking_id, rental_unit_id)`; indexes `(rental_unit_id, starts_at)`, `(booking_id)`.
- RLS: members select via `user_orgs()`. No insert/update/delete for `authenticated` (the trigger and the definer RPCs write). `service_role` select (the public flows read through the admin client). Explicit GRANTs.
- `bookings_rental_unit_no_overlap` **stays** as a redundant backstop on the primary unit.

### Trigger `sync_booking_units()` on `bookings`, AFTER INSERT OR UPDATE OF status

```
if new.rental_unit_id is null then return new;            -- appointments
v_reserving := new.status in ('confirmed','pending','pending_payment');
if TG_OP = 'INSERT' then
  insert primary row (new.rental_unit_id);
  if offering.kind = 'composite' then
    insert one 'component' row per rental_units row whose offering_id is a component of the offering,
    excluding new.rental_unit_id;
  end if;
else
  update booking_units set reserving = v_reserving where booking_id = new.id;
end if;
```

The function is `security definer` (owner `postgres`, `search_path = ''`): status flips arrive from definer RPCs, from the drain's `service_role` updates (hold expiry, reminders) and from RLS'd member updates, and none of those roles holds a write grant on `booking_units`.

Equipment rows are the only RPC-written rows (below). There is no in-place move anywhere (reschedule = new row + old row `rescheduled`), so `starts_at`/`ends_at` never change after insert; the trigger does not handle it. A 23P01 raised inside the trigger aborts the enclosing RPC and reaches TS as today's `taken`.

### Backfill

`insert into booking_units (…, kind 'primary', reserving computed) select … from bookings where rental_unit_id is not null`. Cannot violate the new EXCLUDE: the old EXCLUDE already guaranteed reserving rows never overlap per unit. No composites exist yet, so no component rows.

### `rental_unit_scope(p_unit_id uuid) returns setof uuid`

`p_unit_id` plus, when its offering is a composite, every unit of every component offering. Both free-checks read `booking_units bu where bu.rental_unit_id in (select rental_unit_scope(p_unit_id)) and bu.reserving and (p_exclude is null or bu.booking_id <> p_exclude)` instead of `bookings`, and the blackout check widens to the same scope (a blackout on an included room blocks the whole studio). Signatures unchanged. Because a whole-studio booking writes rows onto the room units, a *room's* check needs no composite awareness.

### `rental_equipment_lines(p_org_id uuid, p_picks jsonb, p_duration_min int) returns jsonb`

`p_picks = [{offeringId, qty}]`, max 12, distinct ids. For each pick: the offering is the org's, `kind = 'equipment'`, active, `price_cents is not null`, and `1 ≤ qty ≤ count(active units)` — else `raise exception 'quote_equipment'`. Line:

```
{ kind: 'equipment', offeringId, label: name, unit: pricing_mode = 'flat' ? 'flat' : 'hour',
  qty, unitCents: price_cents,
  cents: flat ? price_cents * qty : round(price_cents * qty * p_duration_min / 60.0) }
```

TS mirror `equipmentLines(equipment, picks, durationMin)` in `pricing-rules.ts`/`pricing.ts`; `Line` gains the `equipment` member; `equipmentPicksSchema` (zod). Parity fixtures beside the S1 ones. The S1 quote's signature is untouched; RPCs do `v_lines := public.rental_quote_hours(…) || public.rental_equipment_lines(…)`.

### `create_rental_booking_hours(…, p_people, p_extras, p_equipment jsonb)` and `create_rental_booking_hours_admin(…, p_equipment jsonb)`

Old signatures dropped. Changes to the bodies:

1. Refuse `v_off.kind = 'equipment'` with `not found`.
2. `v_lines := rental_quote_hours(…) || rental_equipment_lines(v_org.id, coalesce(p_equipment,'[]'), p_duration_min)`. Total, deposit, hold and status follow unchanged.
3. After the booking insert (the trigger has written primary + component rows): for each pick, `select u.id from rental_units u where u.offering_id = pick and u.active and rental_unit_is_free_hours(u.id, tz, starts, ends, 0, null) order by u.sort_order, u.created_at limit qty`; fewer than `qty` → `raise 'taken'`; insert `booking_units` rows with `kind 'equipment'` and the booking's `reserving`.

The dates RPCs (`create_rental_booking`, `reschedule_rental_apply`) get **no** signature change: composites and equipment are hours only (ruling 8); the trigger writes their primary rows.

### `reschedule_rental_hours_apply` (same signature)

- Derive `v_equipment` from `v_old.lines` where `kind = 'equipment'`, inner-joined to offerings that are still `kind = 'equipment'` and active, `qty` clamped to the active unit count (the S1 extras derivation, one more branch).
- `v_lines := quote || rental_equipment_lines(…)` inside the existing carry block; `quote_equipment` joins the sentinel list.
- After the new booking insert: attach units per pick as in create, preferring the old booking's own equipment units when free (stable lamp across a move), else any free unit of that space, else `raise 'taken'`.

## Behaviour

### Availability (`src/lib/booking/public.ts`)

- `loadOrgHourlyContext` and `loadOrgRangeContext` read `booking_units (booking_id, rental_unit_id, starts_at, ends_at)` with `reserving = true` in place of `bookings`; `excludeBookingId` filters on `booking_id`.
- For a composite offering the unit list is its one unit; its busy set is the union over `rental_unit_scope`: the read fetches `booking_units` and blackouts for the scope ids and folds them onto the virtual unit. A new `scopeUnitIds(offering)` helper (components resolved once per request) serves both the hours context and the admin slot action.
- `listPublicOfferings`, `getPublicOfferingById` (as primary) and every template/hosted-page list filter `kind <> 'equipment'`.
- New `listEquipmentAvailability(orgId, fromIso, toIso)` → `[{ offeringId, name, priceCents, pricingMode, units: [{ id, busy[] }] }]` for the add-on step and the reschedule panels; `freeUnitsAt(equipment, startsAt, endsAt)` counts what is free (pure, tested).
- Reschedule panels (`HourlyReschedulePanel`, `rescheduleRentalHoursAdmin`'s slot action) fold the attached equipment's busy time (excluding the booking being moved) into every room unit's busy before slotting — ruling 11.

### Widget — `HourlyBookingFlow`

- Add-on rows: S1 extras (unchanged) then equipment, each with the price per hour or per booking, a stepper capped at `min(freeUnitsAt(slot, duration), units.length)` and a quiet "N available" (0 → row disabled, "none left at this time"). Changing slot or duration re-caps and drops picks that no longer fit.
- `quoteHours(...)` result is concatenated with `equipmentLines(...)` so the confirm step's total matches the RPC.
- `createRentalBookingHours` action passes `equipment` (zod `equipmentPicksSchema`) to the RPC. `taken` and 23P01 keep their existing "just taken" handling.

### Admin — `/rentals/new`, `/rentals/[id]`

- `/rentals/new`: a "What is it?" segmented choice at the top of `OfferingForm`: **Room** (default, today's form) · **Whole studio** (hours form + "Includes" checkbox list of the org's hourly rooms; at least one) · **Equipment** (name, description, price with per hour / per booking, "How many items", active). Equipment hides hours, approval, deposit, cancel tiers, terms and pricing rules (ruling 5), and `createOffering` skips the Mon–Fri 9–5 hours seeding (PR #73) for it. `createOffering` writes `kind`, components (composite) and `n` units (equipment; the auto-created first unit counts).
- `/rentals/[id]`: settings form branches on `kind` the same way; components editable for composites (`setOfferingComponents` action, replace-all); `UnitsEditor` hidden for composites, primary for equipment. `SpaceHeader` chip: "Includes 3 rooms" / "Add-on". `OfferingsList` shows the same chip. `createUnit` refuses on a composite (`ActionState` error).
- Deleting a room that is a component: cascades the join row; existing whole-studio bookings lose that room's occupancy rows with the room (the room no longer exists, nothing to block).

### Timeline (`listTimelineData`, `TimelineLane`)

`BOOKING_COLUMNS` embeds `booking_units(rental_unit_id, kind)`; `listTimelineData` fans one `AdminBooking` out to every lane in its `booking_units`, marking non-primary placements so the lane draws the block with the booking's title (the whole studio's name on a room lane, the client's name on the lamp lane) in the existing muted "blocked" style rather than as a second editable booking. Click opens the same detail dialog.

### Booking detail and manage page

`BookingDetailDialog` and `/booking/[token]` list "Also reserved: Room A, Room B" from the booking's component rows (one extra select on `booking_units` joined to `rental_units`); equipment already appears through the money lines (`BookingMoneySummary` renders `kind = 'equipment'` by label like an extra). Emails, calendar sync, daily list and digest: unchanged (ruling 4).

## i18n (en, pl, uk)

`rentals.kind.{space,composite,equipment}` + short descriptions, `rentals.form.includes`, `rentals.form.itemCount`, `rentals.form.pricePer{Hour,Booking}`, `rentals.chip.includes {count}`, `rentals.chip.addon`, `rentals.detail.alsoReserved`, `public.addons.available {count}`, `public.addons.noneLeft`, `public.errors.equipmentTaken` (reused `taken` copy where it fits). The parity test enforces all three files.

## Tests

- **Unit**: `equipmentLines` (hour rounding at 90 min, flat × qty, unknown/inactive id throws the sentinel), `equipmentPicksSchema`, `freeUnitsAt`, `scopeUnitIds` fold, offering zod for `kind`/components, `listTimelineData` fan-out (mocked rows).
- **SQL ≡ TS parity**: `rental_equipment_lines` vs `equipmentLines` on the same fixtures (S1 harness).
- **Integration** (local Supabase, one new file `compound.integration.test.ts` + additions to `hourly-rpc`/`change-consequences`): backfill count = rental bookings; whole-studio booking → room booking in the window fails with 23P01/`taken`, and the reverse; room blackout blocks the whole studio; the same lamp attached from two rooms at the same hour fails; two lamps, two rooms, one hour passes; cancel/decline/expire clears `reserving` and frees the rooms; reschedule carries the lamp, refuses when the lamp is taken at the new time, drops the line when the equipment space is inactive; component guard rejects cross-org, dates-mode, self and non-composite parents; `createUnit` on a composite refused; equipment as primary refused; `listPublicOfferings` hides equipment.
- **Browser QA**: scripted Playwright, org flipped to Spaces mode: create 2 rooms + whole studio + a 2-unit lamp; book the studio publicly and see both rooms blocked on the timeline; book a room with one lamp, then the other room with two lamps fails at the cap; reschedule with the lamp; cancel and re-book.

## Security

`booking_units` and `rental_offering_components` under RLS; members read, only triggers and definer RPCs write; `service_role` reads for the public flows. The public create RPC validates picks in SQL (`rental_equipment_lines` refuses foreign, inactive or oversize picks with a sentinel, never a row). Equipment cannot be booked alone through any RPC. No new env, no new secrets.

## Deferred (stated, not silent)

- Per-room equipment allowlist; equipment bookable on its own; equipment in the appointments channel.
- Dates-mode composites and equipment.
- Retro-blocking a unit added to an included room after a whole-studio booking exists (ruling 7); a `createUnit` hook could write component rows for future composite bookings.
- Ad-hoc multi-room picks in the widget.
- Equipment turnover / prep time; equipment blackouts UI (the table supports them via the unit).
- Composite-specific "blocked by whole studio" visuals beyond the muted lane block; per-lane filter on the timeline (already deferred from PR #67).
- Equipment rows in S4's daily list and the digest (a lamp is never the row's subject).
- Dropping the redundant `bookings_rental_unit_no_overlap` once `booking_units` has run for a while.
