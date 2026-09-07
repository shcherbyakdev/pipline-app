# Google Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider connects Google once; confirmed bookings mirror into a chosen calendar and Busy events in ticked calendars block the booking page.

**Architecture:** A trigger on `bookings` upserts pending rows into `booking_calendar_events`; `syncBooking` reconciles desired vs existing Google state per row, run immediately via `after()` from the action tails and every 15 minutes by the existing drain route. Busy time is read live from Google at slot-computation time and merged into the engine's `busy` list. Tokens are AES-GCM sealed, service_role-only.

**Tech Stack:** Next 16 route handlers + server actions, Supabase/Postgres 17 (trigger, service_role tables), `node:crypto` (no Google SDK — REST over `fetch`), Vitest, Base UI cards from the notifications slice.

**Spec:** `docs/superpowers/specs/2026-09-05-google-calendar-design.md`

## Global Constraints

- Migration file is `src/db/migrations/0076_google_calendar.sql` (next free after 0075).
- New tables: `revoke all ... from public, anon, authenticated, service_role;` then `grant all on table ... to service_role;` only. Every RLS-referenced column indexed (none here — no RLS).
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GCAL_TOKEN_KEY` optional; `GOOGLE_OAUTH_BASE` / `GOOGLE_API_BASE` optional and refused when `APP_ENV=production`.
- Reserved handle `integrations` in BOTH `src/features/scheduling/handle.ts` and `reserved_handles()` SQL.
- Copy in both `messages/en.json` and `messages/uk.json` under `integrations.*` and `shell.nav.integrations`; key parity is tested.
- No new npm dependency.
- Google event id = booking uuid with dashes removed.
- Nothing in the sync or busy path may throw into a booking action or a public page: log and continue.

---

### Task 1: Migration 0076 — tables, trigger, reserved handle

**Files:**
- Create: `src/db/migrations/0076_google_calendar.sql`
- Modify: `src/db/migrations/meta/_journal.json` (append entry idx 76, tag `0076_google_calendar`)
- Modify: `src/db/schema/index.ts`, Create: `src/db/schema/calendar-sync.ts` (Drizzle declarations of both tables)
- Modify: `src/features/scheduling/handle.ts` (add `"integrations"`)
- Test: `src/features/calendar-sync/calendar-sync.integration.test.ts`

**Interfaces:**
- Produces tables `calendar_connections`, `booking_calendar_events` exactly as spec §3; trigger `bookings_calendar_queue` calling `public.queue_calendar_sync()`.

- [ ] Write the integration test (pattern: `src/features/notifications/notifications.integration.test.ts`): create org via admin client, insert a confirmed booking → no queue row (no connection); insert a `calendar_connections` row → insert booking → queue row `pending=true`; update `reminder_sent_at` → `updated_at` unchanged; update `status` → `attempts` reset to 0 and `pending=true`; `authenticated` client `select` on both tables → permission error; `is_reserved_handle('integrations')` true.
- [ ] Run `npm run test:integration -- calendar-sync` → fails (relation missing).
- [ ] Write the migration: tables (§3), trigger function (`after insert or update of status, starts_at, ends_at, staff_id, rental_unit_id, client_name, note on bookings`, `when exists(select 1 from calendar_connections c where c.org_id = new.org_id)` inside the function body since WHEN can't subquery), grants, `reserved_handles()` re-declared with `'integrations'`.
- [ ] `npm run db:migrate`; rerun the test → passes.
- [ ] Commit `feat(calendar): 0076 connections, event state, queue trigger`.

### Task 2: Env + crypto + OAuth helpers

**Files:**
- Modify: `src/env-schema.ts`, `src/env.ts`, `.env.example`
- Create: `src/lib/google/crypto.ts`, `src/lib/google/oauth.ts`
- Test: `src/lib/google/crypto.test.ts`, `src/lib/google/oauth.test.ts`

**Interfaces:**
- `googleConfigured(): boolean`
- `seal(plain: string): string`, `open(sealed: string): string` (throws on tamper / wrong key)
- `signState(payload: { orgId; userId; staffId: string | null; nonce; exp }): string`, `verifyState(s): payload | null`
- `authUrl(state: string, redirectUri: string): string`
- `exchangeCode(code, redirectUri, fetchImpl?)` → `{ accessToken, refreshToken, expiresAt }`
- `refreshAccessToken(refreshToken, fetchImpl?)` → `{ accessToken, expiresAt }`; throws `GoogleAuthError("invalid_grant")` when Google says so.

- [ ] Tests: seal/open round trip; flipped byte → throws; different key → throws. State: sign → verify equals; expired → null; tampered → null. `authUrl` contains scopes, `access_type=offline`, `prompt=consent`, `state`. Exchange + refresh with a fake fetch returning Google's JSON; `error: "invalid_grant"` → typed error.
- [ ] Run → fail. Implement. Run → pass. Commit `feat(calendar): env, token sealing, OAuth helpers`.

### Task 3: Google Calendar REST client

**Files:**
- Create: `src/lib/google/calendar.ts`
- Test: `src/lib/google/calendar.test.ts`

**Interfaces:**
- `type GoogleCalendarClient = { listCalendars(): Promise<CalendarInfo[]>; listEvents(calendarId, timeMinIso, timeMaxIso): Promise<GoogleEvent[]>; upsertEvent(calendarId, event: GoogleEventBody & { id }): Promise<void>; deleteEvent(calendarId, eventId): Promise<void> }`
- `createGoogleClient({ getAccessToken: (forceRefresh: boolean) => Promise<string>, fetchImpl? })`
- `CalendarInfo = { id; summary; primary: boolean; canWrite: boolean }` (accessRole owner/writer → canWrite)
- `GoogleEvent = { id; status; transparency?; start: { dateTime?; date? }; end: {...}; extendedProperties?: { private?: Record<string,string> } }`

- [ ] Tests with fake fetch: calendars mapped; events paginated over `nextPageToken`; insert 409 → PUT update; delete 404 and 410 resolve; 401 → token re-fetched with `forceRefresh=true` and request retried once; other 4xx/5xx → throws `GoogleApiError(status)`.
- [ ] Run → fail. Implement. Run → pass. Commit `feat(calendar): REST client`.

### Task 4: Engine flag + connections + event body

**Files:**
- Modify: `src/features/scheduling/slots.ts` (`BusyInterval.external?: true`; max/day count skips it)
- Create: `src/features/calendar-sync/connections.ts`, `src/features/calendar-sync/event-body.ts`
- Test: `src/features/scheduling/slots.test.ts` (one case), `src/features/calendar-sync/event-body.test.ts`

**Interfaces:**
- `type Connection = { id; orgId; staffId: string | null; accountEmail; pushCalendarId: string | null; busyCalendarIds: string[]; calendars: CalendarInfo[]; status: "active" | "needs_reconnect" }`
- `listConnections(orgId, db?)`, `targetFor(staffId: string | null, connections): Connection | null` (person's, else shared)
- `clientFor(connection, db?)` → GoogleCalendarClient (reads/refreshes token, persists `access_token_enc`, on `invalid_grant` calls `markNeedsReconnect` and rethrows)
- `calendarSyncAllowed(orgId)` → boolean (plansEnforced ? entitlements.gcalSync : true)
- `requeueScope(orgId, staffId | null, db?)` — upcoming confirmed bookings of that scope → pending
- `eventIdFor(bookingId)`; `buildEventBody(b: SyncBooking, appUrl)` → body with summary/description/start/end/extendedProperties
- `type SyncBooking = { id; orgId; status; staffId; rentalUnitId; startsAt; endsAt; clientName; clientEmail; note; title; timeZone }`

- [ ] Tests: external busy blocks the slot but two external intervals don't exhaust `maxPerDay: 2`. Event body: id strips dashes; summary `"Anna — Massage"`; description holds email, note, the `/bookings?date=` link in org-local date; timeZone set.
- [ ] Run → fail. Implement. Run → pass. Commit.

### Task 5: Reconcile + drain + kick

**Files:**
- Create: `src/features/calendar-sync/sync.ts`
- Modify: `src/app/api/scheduling/drain/route.ts` (call `runCalendarSyncDrain({}, { db: admin })` after reminders; merge summary as `calendar`)
- Modify (one line each, in the post-commit tail): `scheduling/public-actions.ts` createBooking; `scheduling/manage-actions.ts` cancelBooking, rescheduleBooking; `scheduling/booking-actions.ts` cancelBookingAdmin, rescheduleBookingAdmin, createBookingAdmin, acceptBookingRequest, declineBookingRequest; `rentals/public-actions.ts` createRentalBooking; `rentals/manage-actions.ts` rescheduleRentalBooking, rescheduleRentalBookingHours; `rentals/booking-actions.ts` createRentalBookingAdmin, rescheduleRentalBookingAdmin, createRentalBookingHoursAdmin, rescheduleRentalHoursAdmin; `rentals/hourly-actions.ts` createRentalBookingHours.
- Test: `src/features/calendar-sync/sync.test.ts`

**Interfaces:**
- `syncBooking(row: SyncBooking & { state: { connectionId; calendarId; eventId } | null }, deps: { connections: Connection[]; clientFor; appUrl })` → `{ connectionId; calendarId; eventId } | null` (what now exists)
- `runCalendarSyncDrain(opts: { orgId?: string; limit?: number }, deps: { db; clientFor?; allowed?; now? })` → `{ synced; failed; skipped }`
- `kickCalendarSync(orgId)` → `after(() => runCalendarSyncDrain({ orgId }).catch(log))`

- [ ] Tests (fake client recording calls): confirmed + target, no state → upsert on target; cancelled + state → delete, returns null; state on A, target B → delete A, upsert B; confirmed + no connection → null, no calls; `invalid_grant` from clientFor → rethrows (drain marks and leaves pending). Drain: gate false → rows untouched, `skipped`; failure → attempts+1 and last_error; success → pending false.
- [ ] Run → fail. Implement. Run → pass. Add the 16 kicks. `npm run verify`. Commit.

### Task 6: Busy read + engine merge

**Files:**
- Create: `src/features/calendar-sync/busy.ts`
- Modify: `src/lib/booking/public.ts` (`loadOrgSlotContext` per-staff merge; `loadOrgHourlyContext` per-unit merge; `fresh` option threaded from `scheduling/public-actions.ts` createBooking pre-check and `rentals/hourly-actions.ts` createRentalBookingHours pre-check)
- Test: `src/features/calendar-sync/busy.test.ts`

**Interfaces:**
- `eventsToBusy(events: GoogleEvent[], timeZone): BusyInterval[]` (pure)
- `externalBusy(orgId, staffId: string | null, fromIso, toIso, opts?: { fresh?: boolean }, deps?)` → `BusyInterval[]`, never throws

- [ ] Tests: cancelled / transparent / `bookloBookingId` events skipped; timed event → interval with `external: true`; all-day `date` → org-local midnight to midnight; memo returns the same answer within 60 s, `fresh` bypasses; a throwing client → `[]`.
- [ ] Run → fail. Implement. Run → pass. Commit.

### Task 7: OAuth routes

**Files:**
- Create: `src/app/api/google/start/route.ts`, `src/app/api/google/callback/route.ts`
- Test: `src/app/api/google/oauth-routes.test.ts` (state/cookie logic factored into `src/features/calendar-sync/oauth-flow.ts` so it is unit-testable: `beginConnect({ orgId, userId, staffId })` → `{ url, cookie }`; `completeConnect({ stateParam, cookieNonce, code, deps })` → `{ ok: true } | { ok: false; reason }`)

- [ ] Tests: begin returns Google URL + nonce cookie; complete with mismatched nonce → `state`; expired → `state`; fake exchange + calendarList → row upserted with defaults (primary push, [primary] busy), `requeueScope` called; second connect of the same email → same row, status back to `active`.
- [ ] Routes: `start` — 404 if `!googleConfigured()`, `requireOrg()`, perk via `perkToggle`, `?staff=` optional, 302. `callback` — 302 to `/integrations?connected=1` or `?error=<reason>`.
- [ ] Commit.

### Task 8: Page, actions, nav, copy

**Files:**
- Create: `src/app/(dashboard)/integrations/page.tsx`, `src/features/calendar-sync/queries.ts`, `src/features/calendar-sync/actions.ts`, `src/features/calendar-sync/components/google-calendar-card.tsx`, `.../connection-row.tsx`, `.../how-it-works.tsx`
- Modify: `src/components/shell/nav.ts` (+ `nav.test.ts` expectation), `messages/en.json`, `messages/uk.json`, `src/features/marketing/site.ts` (FORBIDDEN_COPY), `PRODUCT.md`

**Interfaces:**
- `getIntegrationsPage()` → `{ orgId; configured; connections: Connection[]; staff: { id; name }[]; offersAppointments }`
- Actions (ActionResult): `setConnectionCalendars({ connectionId, pushCalendarId: string | null, busyCalendarIds: string[] })`, `setConnectionStaff({ connectionId, staffId: string | null })`, `disconnectCalendar({ connectionId })` — each `requireOrg()` and scopes the write by `org_id`; calendar changes call `requeueScope`.

- [ ] Copy keys: `shell.nav.integrations`, `integrations.intro`, `integrations.google.*` (title, blurb, notConfigured, connect, connectAnother, connected, reconnect, needsReconnect, belongsTo, shared, addTo, dontAdd, blockFrom, disconnect, disconnectConfirm, disconnectNote, paused, proChip, upgrade, connectedToast, errorToast), `integrations.how.*` (three lines).
- [ ] Page states per spec §5; autosave controls (Base UI Select + Checkbox idioms from the notifications components).
- [ ] `npm run verify` (messages parity, nav test, typecheck). Commit.

### Task 9: Fake Google + browser QA + wizard + docs

**Files:**
- Scratchpad: `fake-google.mjs` (node http: `/token`, `/calendar/v3/users/me/calendarList`, `/calendar/v3/calendars/:id/events[...]`, `/o/oauth2/v2/auth` → immediate redirect to `redirect_uri?code=x&state=`)
- Create: `scripts/setup-google-calendar.sh` (wizard skill), `docs/runbook-production.md` section
- Modify: `.env.example`, memory file

- [ ] Run dev with the bases pointed at the fake; Playwright: connect → row; book publicly → fake has the event; cancel → deleted; Busy event in fake → slot hidden. Screenshots to scratchpad.
- [ ] Wizard script; runbook; commit; open PR.
