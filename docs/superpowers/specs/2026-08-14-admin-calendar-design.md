# Admin Week Calendar — Design

**Date:** 2026-08-14
**Status:** Approved
**Slice:** Inserted before S3 (widget/embed postponed by user decision). Builds on S1 (scheduling core, PR #22) and S2 (booking lifecycle, PR #23).

## Goal

Replace the flat bookings list with a full week-view calendar on `/bookings` so the provider can see their week at a glance, manage bookings in place, create walk-in/phone bookings, and block time — visually inspired by a CarJoy-style dashboard (week time-grid, hatched closed hours, colored event cards) but rendered entirely in the app's existing design tokens.

## Scope decisions (user-confirmed)

- **Week view only.** No month/year views (S5 candidate).
- **No drag-to-reschedule.** Rescheduling stays dialog-based (S2 dialogs reused).
- **Interactions:** click booking → manage; drag-select empty range → create booking or block time; click exception-blocked region → reopen day.
- **Availability editing on the grid = date exceptions only.** Recurring weekly rules remain in `/availability`.
- **Admin-created bookings use relaxed rules:** may fall outside open hours and inside min-notice; email optional; true double-booking still blocked.
- **Calendar replaces `/bookings`** with a Calendar | List toggle; the list remains the surface for history and cancelled bookings.
- **Custom-built grid** (Option A) — no calendar library. Week-only + click-based interactions don't justify FullCalendar/react-big-calendar, and a custom grid uses our tokens natively.

## Architecture & data flow

- `/bookings` server page gains a view toggle: **Calendar** (default) | **List** (existing `BookingsList`).
- **Week navigation via URL**: `?week=YYYY-MM-DD` (Monday of the visible week), prev/next arrows, "Today" button. Server component re-fetches per week; no client data cache.
- **Per-week server fetch:** confirmed bookings in the week's UTC range; availability rules; exceptions for the 7 visible dates; active services (create dialog); org settings (timezone).
- **All rendering in the org timezone.** Positioning math works on org-local wall-clock times, reusing `wallTimeToUtc` / zone helpers from `slots.ts`.
- **Grid shows confirmed bookings only.** Cancelled/rescheduled appear only in the List view.

## Grid & components

`CalendarWeek` (client component):

- Sticky day-header row (Mon–Sun with dates, today highlighted); hour-label gutter; seven day columns with hour lines.
- **Dynamic hour range:** union of open hours across the visible week, padded 1h each side; fallback 08:00–18:00 when nothing is open.
- **Closed time** rendered hatched; open time plain. A "now" line on today's column.
- **Booking cards:** absolutely positioned by start/end; show service name, client name, time; left accent bar colored by a stable hash of the service id (no new settings surface). Cards under ~30min render one-line compact. Overlapping confirmed bookings cannot exist (DB EXCLUDE guard).
- Narrow viewports: horizontal scroll with the hour gutter pinned; no separate mobile layout in this slice.

## Interactions

1. **Click booking card** → detail popover (service, client, time, note, status) with Cancel / Reschedule buttons wired to the existing S2 components (`manage-booking.tsx`, `booking-reschedule-dialog.tsx`) unchanged.
2. **Drag-select empty range** (pointer events, snapped to 15 min) → popover with two actions:
   - **New booking** → dialog pre-filled with the selected start. Selecting a service sets the end from its duration (drag end is only a hint). Fields: client name (required), email (optional), note. Inline non-blocking warning when outside open hours or inside min-notice; overlap with an existing booking is a hard error.
   - **Block time** → confirm, then rewrite that date's exceptions to: current effective windows minus the selection; if nothing remains, a single `closed` exception.
3. **Click blocked/closed region on a date that has exceptions** → "Reopen day": deletes that date's exceptions, restoring weekly rules. Sub-range unblocking is out of scope; reopening the day is the escape hatch.

## Backend changes

### Admin booking creation

- **Migration:** `bookings.client_email` becomes nullable (walk-ins). Reminder drain and confirmation/cancel emails skip bookings with no email (drain stamps them as suppressed, same idiom as the <24h suppression). A cancel token is still minted — schema requires the hash and it is harmless.
- **New `create_booking_admin` RPC** in a SQL migration (0026 idiom: security surface in reviewable SQL, sibling to `reschedule_booking_admin`). Authenticated + org-scoped. Inputs: service id, start, client name, optional email, optional note. Computes `ends_at = starts_at + duration_min`, matching `create_booking` (verified in 0026 — buffers affect slot spacing only, not the stored span). **No** open-hours or min-notice validation. The EXCLUDE guard enforces no-double-booking; callers map SQLSTATE `23P01` to a friendly "overlaps an existing booking" error.
- **Server action `createBookingAdmin`:** zod-validated wrapper; sends the confirmation email only when an email was provided; toast claims an email was sent only when it actually was (honest-toast rule from S2).

### Block time

- **Server action `blockTimeRange`:** input date + wall-clock range. Recomputes the date's effective windows (override exceptions if present, else weekday rules), subtracts the range, then replaces the date's exception rows: delete existing, insert override windows, or one `closed` row if nothing remains. Sequential Supabase calls, matching the existing availability actions; single-admin orgs make the non-atomic window negligible.
- **Reopen day** reuses the existing `deleteAvailabilityException` action.

## Error handling

- Overlap on admin create → `23P01` mapped to a clear inline error in the dialog.
- All mutations follow existing toast patterns; failure toasts are specific (which step failed), success toasts never overclaim (email wording conditional).
- Block-time subtraction that yields zero-length fragments (< slot granularity) drops them rather than writing degenerate windows.

## Testing

- **Unit (Vitest):**
  - Window-subtraction math for block-time: range spans whole day; partial overlap at start/end edges; date already overridden; range outside open hours (no-op windows); fragment dropping.
  - Grid time→position helpers and dynamic hour-range computation (pure functions, extracted deliberately).
- **Integration (pg-backed suite):** `create_booking_admin` succeeds outside open hours; succeeds without email; rejects overlap (EXCLUDE); reminder drain skips emailless bookings.
- **E2e (Playwright):** one flow — open calendar, create a walk-in booking, see the card render.

## Out of scope

- Drag-to-reschedule / drag-to-resize cards.
- Month and year views (S5).
- Sub-range unblocking of exception-blocked time.
- Editing recurring weekly rules from the grid.
- Dark CarJoy-style theming (layout borrowed; tokens stay ours).
- Multi-staff/resource lanes (app is solo-provider by design).

## Post-implementation

- Run `graphify update .` (repo rule).
- Carried-over S3 items (resend-link, a11y pair) are unaffected and remain earmarked for the embed slice when it resumes.
