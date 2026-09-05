# Google Calendar — Design

**Date:** 2026-09-05
**Status:** Built with the spec (autonomous session, same footing as the
notifications slice: recommendations accepted, rulings open for review)
**Precedent:** notifications (spec 2026-09-05: env-gated optional channel,
`perkToggle` perk gate, own top-level page in the account group), reminder
drain (`features/scheduling/reminders.ts`: claim / rollback / attempts),
push subscriptions (0075: rows the browser must never read), the
`bookings_locale_carry` trigger (0072: the only trigger on `bookings`)

## 1. Goal

A provider connects their Google account once and from then on:

1. **Bookings appear in Google Calendar.** Every confirmed booking becomes
   an event in a calendar they choose. Cancel, decline, reschedule and
   accept keep the event in step. A pending request is not an event until
   it is accepted.
2. **Google keeps the booking page honest.** Anything marked *Busy* in the
   calendars they tick blocks those times on the public booking page, in
   the manage page's reschedule picker and in the admin reschedule dialog.
3. **Booklo stays the record.** Edits happen in Booklo; the Google event is
   a mirror. Moving the event in Google does not move the booking (Calendly
   ruling; stated on the page).

`gcalSync` has been a declared Pro/Team perk in `lib/billing/plans.ts`
since the billing slice, never read. This slice reads it.

## 2. Decisions

1. **One hook for every write: a trigger.** Bookings are written by about
   twelve `security definer` RPCs behind sixteen thin action wrappers, and a
   reschedule is *insert new + mark old*. An `AFTER INSERT OR UPDATE` trigger
   on `bookings` upserts a row into `booking_calendar_events` with
   `pending = true` whenever a column that matters changes (`status`,
   `starts_at`, `ends_at`, `staff_id`, `rental_unit_id`, `client_name`,
   `note`). It fires only for orgs that have a connection, so the other
   orgs pay nothing. Sixteen call sites cannot drift; a crash between the
   RPC and the app-side tail cannot lose a sync.
2. **Immediate, then guaranteed.** The action wrappers already have a
   "past this line the booking exists" tail; each gets one line,
   `kickCalendarSync(orgId)`, which runs the org's pending rows in
   `after()` once the response is sent. The 15-minute Worker tick
   (`/api/scheduling/drain`, same secret, same Worker, no new infra) runs
   the same function for every org, so a failed push is retried up to
   five times and a missed kick is at most fifteen minutes late.
3. **Reconcile, not "on create / on cancel".** `syncBooking(row)` computes
   the *desired* state — an event in exactly one (connection, calendar), or
   none — from the booking's status and staff, compares it with what the
   row says exists, and issues the delete / insert / update that closes the
   gap. Every lifecycle transition, including an admin moving a booking to
   another person or the owner changing the destination calendar, is the
   same three-way compare.
4. **Deterministic event ids.** The Google event id is the booking uuid
   without dashes (valid base32hex). Insert is idempotent: a 409 means the
   event exists (or was deleted earlier) and becomes a full `update` with
   `status: confirmed`. No event id needs to survive a crash.
5. **Who a calendar belongs to.** A connection has a nullable `staff_id`:
   *a person* (their busy time blocks only their slots; their bookings go
   to their calendar) or *shared* (`null`: busy time blocks everyone —
   every person and every unit; bookings with no person, i.e. spaces, go
   here). A booking's target is the connection for its `staff_id`, else
   the shared one. Default at connect time: the org's only active person
   when there is exactly one and the org offers appointments, else shared.
   The page shows the choice only when it can matter (two or more active
   people).
6. **Busy is read live.** Slot computation asks Google for the window it
   is about to render (`events.list`, `singleEvents`, one call per ticked
   calendar) and merges the answer into the engine's `busy` list as
   `{ startsAt, endsAt, external: true }`. `external` keeps a Google block
   from consuming the service's `maxPerDay` (the engine counted every
   interval without a `serviceId`). Events Booklo itself wrote (private
   extended property `bookloBookingId`) are skipped — the booking is
   already in `busy` with its buffers, and a reschedule must be allowed to
   overlap its own old time. Cancelled and *Free* (transparent) events are
   skipped. All-day events block the whole org-local day. A 60-second
   in-memory memo per (connection, calendar, window) keeps a busy widget
   from hammering Google; the public create pre-check passes `fresh` to
   bypass it, so the slot a client is about to take is checked against
   Google at that moment. No webhooks, no mirror table: nothing to renew,
   nothing to drift.
7. **Tokens.** Google's refresh token and the current access token are
   AES-256-GCM sealed with `GCAL_TOKEN_KEY` (`node:crypto`, ~20 lines,
   `v1.<iv>.<tag>.<ct>`), stored on `calendar_connections`, readable by
   `service_role` only — no `authenticated` grant at all, no RLS policy to
   get wrong. The page reads through `requireOrg()` + the admin client and
   returns only the columns it renders. An `invalid_grant` on refresh
   (revoked in Google, password change) marks the connection
   `needs_reconnect`; sync and busy reads skip it; the page shows a
   Reconnect button that runs the same OAuth flow and lands on the same
   row (unique per org + Google account).
8. **Scopes.** `calendar.events` (read and write events on any calendar the
   account can see) and `calendar.calendarlist.readonly` (the picker).
   No `userinfo`: the primary calendar's id *is* the account email.
   `access_type=offline`, `prompt=consent` so a refresh token is issued on
   every connect (Google only sends one on first consent otherwise).
9. **Plan gate, three layers.** `perkToggle(org, e => e.gcalSync)` gives
   the page a Pro chip + upgrade link on Free while plans are enforced and
   disables Connect; `/api/google/start` refuses; the drain and the busy
   read consult `calendarSyncAllowed(orgId)` (admin-side: not enforced, or
   entitled). A lapsed Pro keeps its connection, the page says sync is
   paused, pending rows wait without burning attempts, busy blocks stop.
   Same shape as the reminder lead.
10. **Event content.** Summary `"{client} — {service}"`, or the shared
    `booking_title` (space + unit) for stays. Description: client email,
    the note, "Booked through Booklo" and a link to the day on
    `/bookings?date=`. Org timezone on start/end. Google's default
    reminders. No attendees: adding the client would make Google mail them
    a second invitation from the owner's account (deferred, §8).
11. **Disconnect keeps the events.** Deleting the connection cascades the
    state rows; events already in Google stay (Calendly behaviour; the
    confirm dialog says so). Changing the destination calendar re-queues
    every upcoming confirmed booking in the connection's scope so the
    mirror moves.
12. **Page and nav.** `/integrations`, account group, between Notifications
    and Settings, plug icon. `integrations` joins the reserved handles
    (app list + SQL mirror, 0066/0075 idiom). One integration today; the
    name is the honest noun for the thing.
13. **Configuration.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
    `GCAL_TOKEN_KEY` (32 bytes base64). Any missing → the page says "not
    set up on this server", the OAuth routes 404, the trigger still runs
    (it only checks for connections, and there are none). Optional
    `GOOGLE_OAUTH_BASE` / `GOOGLE_API_BASE` point the client at a fake for
    local QA; never set in production (env schema refuses).
14. **Marketing.** Shipping this lifts `google` and `calendar sync` from
    `FORBIDDEN_COPY` (PRODUCT.md rule "until those features ship"). Copy
    itself is Wave 5's.
15. **Not in this slice.** Google → Booklo edits, attendees / Meet links,
    nightly stays blocked by all-day events, Outlook / iCloud, a
    Google-events overlay on the admin week grid (§8).

## 3. Data (migration 0076)

```sql
create table calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- null = shared (blocks everyone; receives bookings with no person)
  staff_id uuid references staff(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,  -- who connected
  provider text not null default 'google' check (provider = 'google'),
  account_email text not null,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  -- where bookings go; null = don't add
  push_calendar_id text,
  -- which calendars' Busy events block time
  busy_calendar_ids text[] not null default '{}',
  -- [{id, summary, primary, canWrite}] cached at connect / refresh
  calendars jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','needs_reconnect')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, account_email)
);
-- service_role only: revoke all from public, anon, authenticated.

create table booking_calendar_events (
  booking_id uuid primary key references bookings(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  -- what exists in Google right now (null = nothing)
  connection_id uuid references calendar_connections(id) on delete set null,
  calendar_id text,
  event_id text,
  pending boolean not null default true,
  attempts int not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
create index on booking_calendar_events (org_id) where pending;
-- service_role only.

-- Trigger: after insert or update of the columns that matter, when the org
-- has at least one connection: upsert (booking_id) pending = true, attempts = 0.
```

`reserved_handles()` gains `'integrations'`.

## 4. Modules

```
src/lib/google/
  crypto.ts        seal(plain) / open(sealed)           — AES-256-GCM, env key
  oauth.ts         authUrl(state), exchangeCode(code), refreshAccessToken(rt),
                   signState / verifyState (HMAC, 10-minute expiry)
  calendar.ts      GoogleCalendar client over fetch: listCalendars, listEvents
                   (paginated), upsertEvent (insert → 409 → update),
                   deleteEvent (404/410 = done). Injected fetch; one retry
                   after a 401 with a fresh access token.
src/features/calendar-sync/
  connections.ts   listConnections(orgId), targetFor(booking, connections),
                   accessTokenFor(connection) (refresh + persist),
                   markNeedsReconnect, gate calendarSyncAllowed(orgId)
  event-body.ts    pure: booking row → Google event body + id
  sync.ts          syncBooking(row, deps), runCalendarSyncDrain({orgId?}, deps),
                   kickCalendarSync(orgId) (after())
  busy.ts          externalBusy(orgId, staffId | null, fromIso, toIso, {fresh})
                   pure eventsToBusy(events, timeZone)
  queries.ts       page read: connections (safe columns), staff list, perk
  actions.ts       setConnectionCalendars, setConnectionStaff, disconnect
  components/      google-card.tsx (states), connection-row.tsx
src/app/api/google/start/route.ts     GET → 302 to Google (session, perk, state cookie)
src/app/api/google/callback/route.ts  GET → exchange, calendarList, upsert row, 302 /integrations
src/app/(dashboard)/integrations/page.tsx
```

Engine touch: `BusyInterval.external?: true`; `computeSlots` skips external
intervals in the max/day count. `loadOrgSlotContext` merges
`externalBusy(orgId, staffId, …)` per person; `loadOrgHourlyContext` merges
`externalBusy(orgId, null, …)` into every unit.

## 5. Flows

**Connect.** Page button → `GET /api/google/start` (requires session + org,
perk, env) → signs `{ orgId, userId, staffId?, nonce, exp }`, sets an
httpOnly nonce cookie, 302 to Google. Callback verifies state + cookie,
exchanges the code, reads `calendarList`, derives the account email from
the primary calendar, upserts `calendar_connections` on
`(org_id, account_email)` (a reconnect refreshes the token and clears
`needs_reconnect`), defaults `push_calendar_id` = primary and
`busy_calendar_ids` = [primary] on first connect, re-queues the scope's
upcoming confirmed bookings, redirects to `/integrations?connected=1`.
Any failure → `/integrations?error=<code>` and a log line.

**Push.** Trigger marks pending → `kickCalendarSync` → `runCalendarSyncDrain`
for that org: reads pending rows (attempts < 5, oldest first, 50 per run),
loads the booking with its names and the org's connections, `syncBooking`
each in its own try. Success: `pending = false`, state columns updated (or
the row deleted when nothing exists in Google and nothing should).
Failure: `attempts + 1`, `last_error`. `invalid_grant`: connection →
`needs_reconnect`, row left pending, attempts untouched.

**Busy.** `externalBusy` picks the connections that apply (the person's +
shared, `active`, gated), lists events per ticked calendar for the window,
converts, memoises for 60 s unless `fresh`. Any Google failure logs and
returns `[]` — a Google outage must not close the booking page.

**Page.** States: not set up (env) · Pro chip (gated) · not connected ·
connected (rows) · needs reconnect (row banner). Per row: account email,
"This calendar belongs to" (shown at 2+ people), "Add bookings to"
(writable calendars + "Don't add"), "Block time from" (checkbox per
calendar), Disconnect (confirm). "Connect another account" under the list.
Autosave per control (row-switch idiom). A "How it works" card with three
lines.

## 6. Testing

- `crypto.test.ts` — round trip, tamper, wrong key.
- `oauth.test.ts` — auth URL params, state expiry/tamper, exchange + refresh
  with injected fetch (`invalid_grant` surfaces as a typed error).
- `calendar.test.ts` — pagination, 409 → update, 404/410 delete ok, 401 →
  refresh → retry once.
- `event-body.test.ts` — id derivation, summary for service / stay,
  description lines, timezone.
- `sync.test.ts` — the reconcile table: confirmed + target → insert;
  cancelled + existing → delete; target moved → delete + insert; no
  connection → row deleted; paused plan → untouched; `invalid_grant` →
  reconnect marker.
- `busy.test.ts` — skips cancelled / transparent / own marker, all-day →
  org-local day, memo + `fresh`.
- `slots.test.ts` — an external interval blocks but does not count for
  max/day.
- Integration (local Supabase, 0076): trigger enqueues on insert and on a
  tracked-column update, not on `reminder_sent_at`, not for an org
  without a connection; `authenticated` cannot read either table;
  `integrations` is reserved.
- Browser QA with a local fake Google (scratchpad script behind the base
  URL overrides): connect → row appears with the fake's calendars → make
  a booking → fake shows the event → cancel → event gone → a Busy event
  in the fake hides the slot on the public page.
- Real-credentials QA is the owner's: `scripts/setup-google-calendar.sh`
  walks the Google Cloud console once (project, Calendar API, consent
  screen in Testing with the owner as test user, web client, redirect
  URIs for localhost / test / prod) and writes the three env values
  locally and on Vercel.

## 7. Plan split

| | Free | Pro | Team |
|---|---|---|---|
| Google Calendar | — (chip + upgrade) | ✓ | ✓, one calendar per person |

## 8. Deferred

- **Admin week-grid overlay** of Google events (grey blocks): `externalBusy`
  already returns the intervals; the grid needs a render type.
- **Attendees / Meet link** on the event (opt-in; Google mails the client).
- **Two-way edits** (Google → Booklo): needs `events.watch` channels, renewal,
  and a conflict rule; Booklo-is-the-record is the product stance until a
  customer asks.
- **Nightly stays vs all-day events**: the day-grid engine has no busy
  input; a per-unit calendar mapping would be the shape.
- **Outlook / iCloud**: `provider` column and the client seam are ready;
  the OAuth and API modules are Google-specific.
- **Google verification**: the `calendar.events` scope is *sensitive*; the
  consent screen stays in Testing (100 test users) until the app is
  verified — a launch-checklist item, not code.

---

## v2 — Calendly parity (same day, ruling: "make the same integration as Calendly has")

Calendly's Google connection does three more things than v1 (its help pages,
verified 2026-09-05): the invitee is a **guest** on the event; and two opt-in
switches — *"When you decline or delete a Calendly meeting in Google Calendar,
it'll also be canceled in Calendly"* and *"When you update the date or time of
a Calendly meeting in Google Calendar, it'll also be rescheduled in Calendly."*
Decision 15 ("no Google → Booklo edits") is superseded by this section; the
How-it-works copy changes with it. Left out on purpose: buffers written as
separate events (Calendly optional, nobody asked) and Google Meet (Calendly's
is an event-type *location*; Booklo has no location concept — its own slice).

### v2 decisions

16. **Clients are guests.** `invite_clients` per connection, default on
    (Calendly's default). The event carries the client as an attendee
    (`guestsCanInviteOthers`/`guestsCanSeeOtherGuests` false) and every write
    passes `sendUpdates=all`, so Google mails the invitation, updates and the
    cancellation from the owner's account. Booklo's own mails stay (they carry
    the manage link — the client's record). The switch says the client gets
    both. Off → no attendee, no Google mail.
17. **Two inbound switches, off by default**, Calendly's wording:
    `cancel_on_delete` and `reschedule_on_move`. Both read the same signal:
    a Google event that carries our `bookloBookingId` marker and now differs
    from the booking. A deleted event (status `cancelled`) or one the account
    declined → cancel the booking as the provider (client cancellation mail,
    staff notice). A moved event → reschedule through Booklo's own rules
    (engine pre-check with the booking excluded and a fresh Google read,
    then `reschedule_booking_system`; the client gets the reschedule mail
    with a new manage link). Start moves; the duration stays Booklo's — the
    mirror re-asserts the end. Appointments only: a moved stay or hourly
    space snaps back with a notice (their reschedule RPCs are session-bound;
    a later slice). With a switch off, Google is left alone — the mirror is
    re-asserted only when the booking next changes (Calendly behaviour).
18. **Refusals snap back and say why.** A move the engine or the database
    refuses (slot taken, outside hours, Busy in Google, past) re-queues the
    booking so the mirror puts the event back, and writes a one-line
    `inbound_notice` on the connection that the /integrations row shows until
    the next clean poll; the connecting user also gets a push. No email.
19. **Detection: push + poll.** `events.watch` on the destination calendar
    (channel token = HMAC of the connection id, address =
    `/api/google/webhook`, Google's 7-day cap), renewed by the tick when
    under a day left, stopped when both switches are off. Every
    notification and every tick runs the same `pollConnection`: one
    `events.list` with `updatedMin` = last check minus five minutes,
    `showDeleted`, filtered to our marker. Idempotent by construction: a
    cancelled booking, a row already rescheduled, or an event whose id no
    longer matches the booking's state is skipped. Locally (http origin)
    no channel is created and the tick polls; the fake Google posts the
    notification itself so the webhook path is exercised too.
20. **Domain verification.** Google only pushes to a verified domain:
    `GOOGLE_SITE_VERIFICATION` renders Next's `metadata.verification.google`
    tag; the wizard walks Search Console → Cloud console → Domain
    verification. Absent → no watch, poll only.

### v2 data (migration 0077)

```sql
alter table calendar_connections
  add column invite_clients boolean not null default true,
  add column cancel_on_delete boolean not null default false,
  add column reschedule_on_move boolean not null default false,
  add column watch_channel_id text,
  add column watch_resource_id text,
  add column watch_expires_at timestamptz,
  add column inbound_checked_at timestamptz,
  add column inbound_notice text;
-- reschedule_booking_system(p_booking_id, p_starts_at, p_token_hash): the
-- admin reschedule body without the membership guard; service_role only.
```

### v2 modules

`lib/google/calendar.ts`: `listEvents` options (`updatedMin`, `showDeleted`),
`sendUpdates` on writes, `watchEvents`, `stopChannel`. `features/calendar-sync/
inbound.ts`: `classifyInbound` (pure), `pollConnection`, `applyGoogleCancel`,
`applyGoogleReschedule`, `ensureWatch`, `runInboundDrain`. Route
`app/api/google/webhook/route.ts`. Page: three switches + the notice line.
