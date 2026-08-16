# Availability Editor Redesign (Design)

**Date:** 2026-08-16 · **Branch:** `availability-editor`
**Context:** post-MVP polish slice; parent product spec `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md`

## Context

The `/availability` page is functionally complete but crude: per-day add/delete
forms, raw `HH:MM–HH:MM` text, no in-place editing, no copy-between-days, no
timezone context, and "Exceptions" limited to one window per date. This slice
rebuilds it Calendly-style (reference screenshot: day rows with time-range
boxes, per-interval delete, `+` add, "Copy hours to…" popover, "Unavailable"
empty state).

Both consumption engines already support the target semantics — `slots.ts` and
`day-windows.ts` (`effectiveWindows`): a closed exception kills the day, open
exceptions REPLACE the weekday rules (multiple rows per date supported), and
there is no uniqueness constraint on `(org_id, date)`. **No migration is needed
for capability** — only (optionally, chosen: yes) for integrity.

## User decisions (2026-08-16)

1. **Autosave per change** — no Save button; every completed edit persists
   immediately (matches the repo's action-per-mutation pattern).
2. **Overlaps rejected with inline error** — client, action, and DB layers.
3. **Time input = combobox** — typeable + dropdown (15-min steps), locale
   12h/24h display.
4. **Calendly-style date overrides** — rename "Exceptions", date picker +
   unavailable-or-custom-hours with the same interval editor, multiple
   intervals per date.

## Weekly hours UI

- Rows Mon → Sun (existing `WEEKDAY_ORDER`). Each row: short day label
  ("Mon."), the day's intervals sorted by start, per-interval trash button,
  and on the row: `+` (add interval) and copy (popover) buttons.
- Empty day renders muted "Unavailable".
- **Time combobox** (shared component, also used by overrides):
  - Dropdown lists 00:00–23:45 in 15-minute steps; the end-time dropdown lists
    only times after the interval's start (Calendly behavior), plus 23:59 as
    the final "end of day" option.
  - Free typing accepted and parsed leniently: `9`, `9:15`, `915`, `0915`,
    `9:15 pm`, `21:15` → canonical `HH:MM`. Unparseable input reverts to the
    last saved value on blur.
  - Display format follows the browser locale via `Intl.DateTimeFormat`
    (12h with AM/PM or 24h); stored/transmitted values are always `HH:MM`.
  - Off-grid stored values (e.g. legacy `09:10`) display fine and are only
    changed when the user edits them.
- **Add interval (`+`)**: empty day → `09:00–17:00`. Non-empty day: start =
  last interval's end + 1h; if `start + 15min` would pass 23:59, drop the
  gap (start = last end); end = `min(start + 4h, 23:59)`. If even the
  gapless 15-minute interval doesn't fit (last end later than 23:44), the
  `+` button is disabled with a title explaining why.
- **Copy hours to… popover**: checkbox list of the other six days (Mon–Sun
  order) + Apply. Semantics: **overwrite** — each checked day's rows are
  replaced by the source day's rows (including "no rows" if the source day is
  empty). Popover built on the existing Popover/Dialog primitives, focus
  managed by them.
- **Autosave**: a combobox change commits on selection (dropdown) or on blur
  (typed); add/delete/copy commit immediately. All writes ride
  `useTransition`; on failure, toast the error and revert the control to
  server state. No optimistic reordering — after a successful edit the row
  re-sorts from revalidated server data.

## Validation (three layers)

Rule: within one day (weekly) or one date (override), intervals must satisfy
`start < end` and must not overlap each other. Touching is allowed
(`13:00–14:00` after `09:00–13:00`).

1. **Client**: instant check before submitting; conflicting interval gets a
   red outline (`aria-invalid`) and the message "Times overlap with another
   set of times" tied via `aria-describedby`; nothing is sent until fixed.
2. **Action**: zod refines the submitted set (`start < end`, sorted,
   non-overlapping); single-interval mutations (`update`, `add`) additionally
   read the day's sibling rows and reject overlap.
3. **DB (migration 0035)**: btree_gist EXCLUDE constraints — the bookings
   0026 idiom applied to availability:
   - `create type public.timerange as range (subtype = time);` (Postgres has
     no built-in time-of-day range type)
   - `availability_rules`: `exclude using gist (org_id with =, weekday with =,
     timerange(start_time, end_time) with &&)`
   - `availability_exceptions`: same over `(org_id, date)` with a
     `where (not closed)` partial.
   - Violations surface as `23P01`; actions map that to the same friendly
     overlap message. Pre-existing overlapping rows (possible today) must be
     merged by the migration before adding the constraints (union per
     day/date, the `addRange` semantics).
   - Mixed state (closed row + window rows on one date) is prevented by
     replace-semantics writes, not by constraint — accepted residual; the
     engines treat closed as dominant either way.

## Date overrides

- Section renamed **"Date overrides"**, subtitle "Days when your availability
  differs from your weekly hours."
- **Add/edit dialog**: native `<input type="date">` (min = today; deliberate
  YAGNI vs a calendar-picker dependency), then either **Unavailable** (toggle)
  or custom hours edited with the same interval-editor rows as weekly days
  (multiple intervals, same combobox, same validation). Prefill for a new
  override: the date's current effective windows via `effectiveWindows(date,
  rules, exceptions)` — the user edits from what the schedule already gives
  that day. Clicking an existing override row reopens the dialog to edit it.
- **Write semantics**: saving replaces all exception rows for that date —
  delete-then-insert (either one `closed` row or N window rows). Non-atomic
  between statements; accepted for a single-editor solo product (a failure
  leaves the date override-less, visible and retryable).
- **List**: upcoming overrides sorted by date, each showing the formatted date
  (org-locale weekday + date), its windows or "Unavailable", and a delete
  button. Past dates already drop off via the existing `gte(date, today)`
  query.

## Timezone context

Under the page title: "Times are shown in {org timezone} · Change in
Settings" (link). Timezone from `getSchedulingSettings()`, `"UTC"` fallback.
Booking correctness already depends on this value; the editor finally says so.

## Actions surface (all member-RLS direct writes, existing file pattern)

- `updateAvailabilityRule({ id, startTime, endTime })` — new.
- `addAvailabilityRule({ weekday, startTime, endTime })` — existing, gains
  sibling-overlap check.
- `deleteAvailabilityRule({ id })` — existing, unchanged.
- `copyDayHours({ sourceWeekday, targetWeekdays[] })` — new; server reads the
  source day's rows (authoritative, not client-supplied) and replaces each
  target day's rows.
- `setDateOverride({ date, closed, windows[] })` — new; replaces all exception
  rows for the date; zod enforces closed XOR non-empty windows.
- `deleteDateOverride({ date })` — new (replaces per-row
  `deleteAvailabilityException`; deletes all rows for the date).
- All return the existing `ActionState`; errors logged with the `fail()`
  idiom; `revalidatePath("/availability")` (and `/bookings` — the calendar
  renders availability).

## Component structure (replaces `availability-editor.tsx`)

- `features/scheduling/time-options.ts` — pure: 15-min options list, lenient
  parser, locale formatter, next-interval default, overlap detector. Unit
  tested (this is where the behavior lives; components stay thin).
- `features/scheduling/components/time-combobox.tsx` — the input.
- `features/scheduling/components/weekly-hours.tsx` — day rows + copy popover.
- `features/scheduling/components/date-overrides.tsx` — list + add/edit dialog.
- `app/(dashboard)/availability/page.tsx` — composes the two sections + tz
  line; queries unchanged (`getAvailabilityAdmin`).

## Out of scope

Multiple named schedules, per-service hours (product spec pins availability
per org), buffers/min-notice (per-service already), calendar-picker
dependency, drag-to-paint editing, org-level 12h/24h preference (browser
locale decides).

## Testing

- Unit: `time-options.ts` (parsing table incl. rejects, formatting 12h/24h,
  next-interval defaults incl. clamps and the disabled case, overlap
  detector); zod schema tests for the three new inputs.
- Integration: 0035 EXCLUDE guards (overlap insert → 23P01; touching rows OK;
  closed rows exempt from the exceptions constraint), `copyDayHours` replace
  semantics, `setDateOverride` replace + closed-XOR-windows, migration's
  pre-merge of overlapping legacy rows.
- Existing `slots.test.ts` / `day-windows.test.ts` stay green (consumption
  semantics unchanged).
- Browser smoke before PR: keyboard-only interval edit, copy popover, override
  round-trip, overlap rejection message.
