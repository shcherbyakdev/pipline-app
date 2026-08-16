# Scheduling S5 — Clients Directory + Overview Stats (Design)

**Date:** 2026-08-16 · **Slice:** S5 (final MVP slice; S4 Google Calendar skipped for MVP)
**Parent spec:** `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md`

## Context

S5 in the roadmap is "Dashboard polish: calendar view, clients directory, stat tiles."
The calendar view already shipped (PRs #24 + #25). This slice delivers the rest:

1. **Clients directory** — `/clients` returns to the nav, scheduling-flavored:
   name, email, booking count, drill-in to booking history.
2. **Overview stat tiles** — bookings this week/month, cancellation rate,
   busiest weekday/hour.
3. **Anonymous-rename fix** (queued for S5 since S1): `create_booking`'s client
   upsert lets anyone who types a known email rename that client.

## Decisions

1. **`/clients` is repurposed, not forked.** The legacy fire-safety clients pages
   (units + portal links) are replaced by scheduling versions. Legacy feature
   components (`portal-links-panel`, `create-client-dialog`, `assign-client`)
   stay on disk (pivot rule: legacy hidden, not deleted) but become unreachable
   from the new pages. `ClientHeader` (inline rename + delete) is **reused as-is** —
   `renameClient` / `deleteClient` actions already exist with RLS member-update
   policies from 0018. Deleting a client keeps booking history: `bookings.client_id`
   is `on delete set null` and name/email are denormalized onto the booking row.
2. **No manual "create client" on the new directory.** Clients appear via bookings
   (public flow or walk-ins). YAGNI per parent spec ("directory from bookings").
3. **Anon rename fix = first-typed name wins.** Migration 0034 redefines
   `create_booking` so the upsert's `on conflict … do update` keeps the existing
   name (`set name = clients.name`) instead of `excluded.name`. The booking row
   still records whatever the booker typed (`client_name`). The provider fixes
   names via the directory. `create_booking_admin` **keeps** rename-on-conflict
   deliberately — walk-in input is the provider's own, authenticated.
4. **Overview is its own page** at `/overview`, first item in the nav. Post-login
   surface stays `/bookings` (S2 user ruling). The Bookings calendar is full-height,
   so tiles don't fit there.
5. **Stats are computed in a pure TS module** (`features/scheduling/stats.ts`),
   unit-tested like the slot engine; one bookings query feeds it
   (`starts_at >= now − 90d`, columns `starts_at, status, created_at` only).
   That single window provably covers all tiles: both booking RPCs bound
   `starts_at` to ≥ now − 24h at insert, so anything created in the last 30 days
   has `starts_at` well inside 90d.
6. **Stat definitions** (all boundaries in the org timezone, week = Mon–Sun,
   reusing `mondayOf` / `dateInZone` / `wallTimeToUtc` / `addDaysISO`):
   - **This week / this month:** count of `status='confirmed'` bookings with
     `starts_at` inside the current week / calendar month (future days included).
   - **Cancellation rate:** over bookings **created** in the last 30 days,
     `cancelled_* / (all − rescheduled)`. `rescheduled` rows are neutral (the
     replacement booking already counts). No denominator → "—".
   - **Busiest weekday / hour:** independent modes of org-tz weekday and start
     hour over `confirmed` bookings with `starts_at` in `[now − 90d, now]`
     (history only, no future). Ties break to earlier weekday (Mon first) /
     earlier hour. Empty → "—". Shown as one tile ("Tue · 10:00").
7. **Stat tile UI follows the dataviz stat-tile contract:** sentence-case label,
   semibold value in proportional figures (no `tabular-nums` at display size),
   optional muted caption naming the window. No charts, no sparklines, no
   palette work in this slice.
8. **UUID guard:** `/clients/[id]` validates the id shape and 404s instead of
   throwing a Postgres `22P02` (the deferred uuid-404 guard, applied where S5
   already works).

## Fold-ins (small, queued from earlier slices)

- **Onboarding → legacy `/programs` redirect fix** (`createOrg` action +
  `/onboarding` page → `/bookings`, copy updated) — hits every new signup.
- **`BookingRow.client_email` type lie** in `features/scheduling/queries.ts`:
  `string` → `string | null` (walk-ins have no email).

## Out of scope

Directory search/pagination/sort controls (solo scale), client merge, CSV export,
tile deltas/sparklines, client notes, email verification, S4 Google Calendar.

## Security

- No new tables, no new grants. New reads ride existing member RLS
  (clients 0018, bookings 0026/0028).
- 0034 narrows what anonymous input can mutate (name no longer overwritable);
  same signature, `or replace` keeps the anon EXECUTE grant (0028 idiom).
- Directory shows name + email only — no sensitive personal data (standing
  solo-operator constraint).

## Testing

- `stats.test.ts`: dense unit tests — week/month boundaries in tz, DST-day hour
  bucketing, cancellation-rate windows/null, busiest modes + tie-breaks,
  future-bookings exclusion.
- `booking-rpc.integration.test.ts`: re-booking test extended to pin
  name-preservation; new member-read test pins the `bookings(count)` embed the
  directory relies on.
- Existing RLS/integration suites must stay green (0034 changes one line of
  upsert semantics).
