# Booking approval (request-to-book) — Design

**Date:** 2026-08-31
**Status:** Approved design, pre-implementation
**Branch precedent:** appointments + spaces (nightly & hourly) all currently auto-confirm at creation.

## 1. Goal

Let a business require manual approval of incoming bookings, configurable per
service and per space. Approval-required bookings arrive as **requests**: they
hold the slot, the business accepts or declines them from the Overview page
(and calendar), and the client is emailed the outcome.

## 2. Decisions (settled with Andrii)

1. **Pending holds the slot.** The DB EXCLUDE guards are widened to cover
   `'pending'`, so accepting can never conflict and declining frees the slot
   by a status flip alone.
2. **Expiry = appointment start, computed.** No cron, no status flip: a row
   with `status = 'pending'` and `starts_at <= now()` *is* expired everywhere
   it's read. A lapsed pending row never blocks future availability (its range
   is in the past).
3. **Decline = email + optional note.** One textarea in the decline dialog;
   the note goes into the client email and is stored on the row (see §3) so
   the audit trail survives.
4. **Visibility:** Overview requests inbox + dashed "ghost" rendering on the
   week calendar and timeline (with accept/decline in the booking detail
   view) + sidebar count pill on Overview + a Pending token in the Bookings
   "Show" scope dropdown.

## 3. Data model (migration 0062)

- `services.requires_approval boolean not null default false`
- `rental_offerings.requires_approval boolean not null default false`
- `bookings.status` CHECK (0026) re-created to add `'pending'` and
  `'declined'`. Full set: `confirmed | pending | declined |
  cancelled_by_client | cancelled_by_provider | rescheduled`.
- `bookings.decline_note text` (nullable, CHECK length ≤ 500) — provider's
  optional message, stamped at decline time.
- EXCLUDE guards re-created with `status in ('confirmed','pending')`:
  - `bookings_no_overlap` (staff-scoped, currently defined in 0041)
  - `bookings_rental_unit_no_overlap` (unit-scoped, currently in 0037)

No new tables → no new GRANTs beyond function grants (columns inherit table
grants; convention memory noted).

### Status semantics

- `pending` + `starts_at > now()` → live request (blocks slot, shown in inbox).
- `pending` + `starts_at <= now()` → **expired** (computed; shown as
  "Expired" in history contexts, excluded from inbox/badge/calendar).
- `declined` → terminal; frees the slot; never rendered on calendar.

## 4. RPC changes (same migration)

All latest definitions are re-created (copy-modify from their newest home):

- **`create_booking`** (0054), **`create_rental_booking`** (0058),
  **`create_rental_booking_hours`** (0058): read `requires_approval` from the
  service / offering row already fetched, insert with
  `status = 'pending'` when set, and include the resulting `status` in the
  return payload so the server action picks the right email + success screen.
  The 23P01 race-settlement idiom is unchanged — pending inserts hit the same
  EXCLUDE.
- **SQL free-check helpers** used by the rental RPCs
  (`rental_unit_is_free`, `rental_unit_is_free_hours`, and `create_booking`'s
  inline conflict pre-check): widen `status = 'confirmed'` →
  `status in ('confirmed','pending')` so pre-checks mirror the constraint.
- **`cancel_booking`** (0058): allow cancelling a `pending` row too (client
  withdraw). Result status stays `cancelled_by_client`; the manage page
  labels it "Withdraw request" while pending.
- **Reschedule RPCs**: unchanged — they already act on `confirmed` only;
  pending requests cannot be rescheduled (accept / decline / withdraw only).
- **Admin RPCs** (`create_booking_admin`, `create_rental_booking_admin`,
  `create_rental_booking_hours_admin`): unchanged — walk-ins always confirm
  instantly.

**Accept / decline are NOT new RPCs.** Provider-side mutations follow the
established direct-update-under-RLS idiom
(`src/features/scheduling/booking-actions.ts`): new server actions update
`bookings` with `.eq("status", "pending")` and `starts_at > now()` guards:

- **Accept:** `pending → confirmed`. Cannot violate EXCLUDE (row already
  holds the slot). Then rotate the manage token (`rotate_booking_token` via
  the admin client — resend-link idiom) and send the existing confirmation
  email with the fresh link.
- **Decline:** `pending → declined`, stamp `decline_note`, email the client.
- Both no-op with a friendly error if the row was already resolved or expired
  (guards fail → 0 rows updated).

## 5. Availability reads (client-visible slots)

Every read that decides "is this slot free for a client" switches from
`status = 'confirmed'` to `status in ('confirmed','pending')`:

- `src/lib/booking/public.ts` (appointment slot generation feed)
- `src/features/rentals/queries.ts` (DATES_TAKEN / hourly availability)

Admin-facing "what's on the calendar" reads are widened *selectively* (see §7
— pending is fetched and rendered as ghost, not merged into confirmed).

## 6. Emails (`src/features/scheduling/templates.ts` + rental equivalents)

| Moment | To client | To provider |
|---|---|---|
| Request created | new "request received — we'll email you when it's confirmed" (manage link) | existing new-booking mail in a "new request — needs your approval" variant |
| Accepted | existing confirmation template (fresh manage link) | — |
| Declined | new "request declined" + optional note | — |
| Withdrawn | existing cancel confirmation | existing cancel notice |

Reminders: the drain already filters `status = 'confirmed'`
(`reminders.ts`), so requests never get reminders; an accepted booking enters
the drain naturally. No change.

## 7. Admin UI

- **Overview inbox** (`src/app/(dashboard)/overview/page.tsx`): a "Requests"
  section above the stat tiles listing live pending requests (client,
  service/space + unit/staff, time, note, price snapshot), each with
  **Accept** and **Decline** (dialog with optional note). Empty state: the
  section collapses to nothing (no permanent empty box on orgs that never use
  approval).
- **Sidebar badge** (`src/components/shell/app-sidebar.tsx`,
  `sidebar-body.tsx`, `mobile-nav.tsx`): count pill of live pending requests
  on the Overview item, server-fetched with the layout.
- **Calendar / timeline ghosts**: pending bookings render dashed/translucent
  in `calendar-week.tsx` and the rentals timeline; the booking detail view
  shows a "Pending approval" state with Accept / Decline actions. Expired
  pendings are not rendered.
- **Bookings list** (`bookings-scope.ts` + `bookings-list.tsx`): new
  `pending` token in the "Show" dropdown, on by default; live requests appear
  in Upcoming with a Pending badge; expired ones appear in History as
  "Expired".
- **Stats** (`computeOverviewStats`): `pending`/`declined` rows are excluded
  from booking counts *and* from cancellation-rate math (a declined request
  never became a booking).

## 8. Config UI

- `service-dialog.tsx` and `offering-dialog.tsx`: a "Require approval"
  switch — copy: *"Require approval — new bookings wait for your confirmation
  instead of confirming instantly."* Default off.
- Booking-page studio forms (`studio/forms/services.tsx`, `spaces.tsx`):
  same switch, since the studio is a primary editing surface post-#76.

## 9. Public flow

- The public payload (service/offering data reaching the widget) carries
  `requiresApproval`; CTA copy becomes **"Request to book"** and the success
  screen says the request was sent and will be confirmed by email — in the
  appointment widget (`booking-widget.tsx`), space form
  (`space-booking-form.tsx`), and hourly flow. Previews follow automatically
  (presentMode: previews render from real data).
- **Manage page** (`manage-booking.tsx`): pending → "Waiting for
  confirmation" banner, cancel button relabeled "Withdraw request";
  declined → terminal "Request declined" state (note shown if present);
  expired → "Request expired".

## 10. Edge cases & rules

- Toggling `requires_approval` never touches existing rows — it only affects
  new creations.
- Accept after start time: refused (expired). Decline after start: also
  refused; the row just reads as expired.
- Client double-submit: EXCLUDE rejects an overlapping second request with
  the same 23P01 → "slot taken" path that confirmed bookings use today.
- Deposits/terms snapshots are stamped at request time as today; money flows
  are out of scope (nothing is charged either way yet).
- Rescheduled-away rows (`rescheduled`) and declines never block slots.

## 11. Testing

- **Migration/RPC integration tests** (existing suite idiom): flag-on create
  inserts `pending`; pending blocks an overlapping public create (both
  kinds); accept flips to confirmed; decline frees the slot for a subsequent
  create; `cancel_booking` withdraws a pending; reschedule of a pending is
  refused; admin create ignores the flag.
- **Unit tests (Vitest)**: stats exclusion; scope-token parsing; expired
  computation helper (single source: one `isExpiredRequest(booking, now)`
  helper used by inbox, badge count, calendar, lists).
- **UI QA** (Playwright, localhost not 127.0.0.1): request → inbox → accept
  → calendar; decline with note → email content; widget CTA copy.

## 12. Out of scope (deliberate)

- TTL/cron expiry, configurable expiry windows.
- "Propose a new time" on decline; batch accept.
- Approval for admin-created bookings; per-staff approval rules.
- Payment/deposit capture tied to approval.
- Push/SMS notification of requests (email only).
