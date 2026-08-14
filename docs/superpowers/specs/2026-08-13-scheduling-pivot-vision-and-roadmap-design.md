# Scheduling Pivot — Vision & MVP Roadmap

**Date:** 2026-08-13
**Status:** Approved (brainstorm with Andrii)
**Type:** Umbrella vision + roadmap. Each slice below gets its own spec → plan cycle before implementation.

## Decision

Full pivot: the product becomes a **scheduling system for solo providers (freelancers / small businesses) and their clients**. The existing platform layer is reused (auth, orgs, branding + logo storage, email transports, drain-cron pattern, tokenized public access, app shell, CI). The fire-safety domain (programs, units, chasing, recurrence, evidence, CSV import) is legacy: **hidden from navigation, code and tables kept** until the new direction is proven.

Rejected alternatives:
- *Retrofit existing domain* (map services onto templates, bookings onto units) — permanent semantic translation tax.
- *Fresh app with ported infra* — redoes CI/env/auth/Supabase setup and proves nothing about the product.

## Product definition

A solo provider signs up, defines **services** and **weekly availability**, and shares a public booking page `/book/[handle]` that also works as an iframe embed. Clients book **without an account**; they manage bookings via tokenized email links. The provider runs everything from the admin dashboard.

- **Actor model:** one bookable calendar per org (solo provider). Availability is per org, not per service — per-service schedules are a possible later extension, deliberately excluded now.
- **No payments at MVP.** Services may show a free-text price label; money changes hands offline. Stripe is a later slice.

## Data model (sketch)

New `scheduling` domain (new Drizzle schema files; RLS + explicit GRANTs per repo convention on every new table):

| Table | Key columns |
|---|---|
| `services` | org_id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, active, sort_order |
| `availability_rules` | org_id, weekday (0–6), start_time, end_time (org-local); multiple rows per weekday allowed (split shifts) |
| `availability_exceptions` | org_id, date, closed-all-day flag or override windows (vacations, one-offs) |
| `bookings` | org_id, service_id, client_id, starts_at/ends_at (timestamptz UTC), status (`confirmed \| cancelled_by_client \| cancelled_by_provider \| rescheduled`), cancel_token_hash, client_note, rescheduled_from_id, google_event_id, created_at |
| `calendar_connections` (S4) | org_id, provider (`google`), encrypted OAuth tokens, status |

Reused/extended:
- `orgs` gains `handle` (unique, public URL), `timezone`, widget branding columns (brand color, welcome text, theme).
- `clients` reused: bookings upsert a client by (org_id, email); directory auto-populates.
- Email transport + drain-style cron reused for confirmations and reminders.

**Double-book guard at the DB level:** Postgres exclusion constraint on `bookings` over `(org_id, tstzrange(starts_at, ends_at))` where status is confirmed. Concurrent bookings of the same slot cannot both commit; the app maps the conflict to a friendly "slot just taken" retry state.

Reschedule creates a **new** booking linked via `rescheduled_from_id`; the old booking atomically gets status `rescheduled` (not a cancelled status), so it no longer blocks slots but is distinguishable from cancellations in history and stats.

## Slot engine

Pure function: `(service, dateRange, rules, exceptions, existingBookings, googleBusy) → slots[]`.

1. Take availability rules for the weekdays in range; apply exceptions.
2. Subtract confirmed bookings inflated by the service's buffers, and Google-busy intervals (S4+).
3. Walk remaining windows in `duration + buffer` steps.
4. Drop slots violating min-notice, max-per-day, or booking-window-days.

Returns UTC instants. UI renders in the **client's browser timezone**, with the org's timezone noted. Pure core → dense unit tests without a DB.

## Booking flow

1. Public page loads branding + active services via anon client (RLS: public read of those only).
2. Client picks service → `getSlots` server action → picks slot → enters name/email/note.
3. `createBooking` server action re-validates the slot in a transaction, upserts client by (org_id, email), inserts booking. Exclusion constraint is the last line of defense; conflict → "slot taken" + fresh slots.
4. Confirmation email with ICS attachment + tokenized manage link `/booking/[token]` (same mint/hash pattern as portal tokens).
5. Reminder ~24h before start via drain cron, recorded idempotently (idempotency-key pattern as in chasing).

**Manage page** `/booking/[token]`: cancel (flips status, emails both parties) or reschedule (same slot picker; new booking created, old one set to `rescheduled` atomically). Token resolution and public booking actions are rate-limited via the existing `rate-limit.ts` approach.

## Public surface

- **Hosted page** `/book/[handle]`: standalone route group outside the dashboard shell (portal-style), server-rendered, mobile-first. Flow: service list → date/slot picker → details form → confirmation. Branding: logo, brand color (CSS variable on buttons/accents), welcome text, light/dark. No auth or cookies — embed-safe by construction.
- **Embed mode**: same page with `?embed=1` — outer chrome hidden, fluid width. Dashboard generates a copy-paste `<iframe>` snippet plus a tiny inline script listening for a `postMessage` height signal so the iframe auto-resizes. No separate JS widget bundle at MVP.
- **Customization scope: brand basics only** (logo, brand color, welcome text, light/dark), with live preview. Theme presets and custom CSS are explicitly out.

## Admin dashboard

Inside the existing app shell; legacy nav items removed.

- **Bookings** — upcoming/past list with cancel/reschedule + client details; week/day calendar view (S5).
- **Services** — CRUD, drag-order, duration/buffers/notice/limits, active toggle.
- **Availability** — weekly grid editor + exceptions (vacation/closed dates).
- **Widget** — branding controls with live preview iframe of the real booking page; embed snippet + public link.
- **Clients** — directory from bookings: name, email, count, history drill-in.
- **Overview** — stat tiles: bookings this week/month, cancellation rate, busiest weekday/hour.
- Org handle + timezone live in existing org settings.

## Google Calendar sync (S4)

- OAuth (offline access, `calendar.events` scope) from dashboard settings; tokens encrypted at rest in `calendar_connections`.
- **Busy-blocking:** slot engine calls FreeBusy for the requested range; short (~60s) cache keeps the booking page fast.
- **Push:** confirmed bookings create a Google event (client as attendee); cancellations delete it; `google_event_id` stored on the booking.
- **Failure posture:** Google down / token expired → booking still works off internal availability; sync is best-effort; dashboard banner prompts reconnection. No inbound webhooks at MVP (request-time FreeBusy covers correctness).

## Error handling

- Slot conflict → constraint violation mapped to friendly retry state, never a 500.
- Email failure → booking still commits; sends retried by drain pattern (as in chasing).
- Expired/invalid manage token → portal-style not-found page; rate-limited resolution.
- All public actions validate with zod and return typed error states per existing server-action conventions.

## Security

- RLS everywhere; explicit GRANTs on every new table (repo convention).
- Anon role: read active services + branding only; **no direct table writes** — bookings go through server actions (anon server client + definer-style boundaries as in the portal).
- Manage tokens stored hashed, single-purpose.
- Data collected: name, email, optional note only (solo-operator constraint: no sensitive personal data).
- S1 residual (accepted): rate limiting + fine-grained slot validation are app-side; the anon `create_booking` RPC itself enforces only integrity checks, the booking window, and the EXCLUDE guard. S2 hardens the RPC (per-org throttle / availability check).

## Testing

- Slot engine: dense Vitest unit tests — DST transitions, buffers, min-notice, max-per-day, exceptions, window edges.
- Booking transaction + exclusion constraint: DB-level tests incl. a concurrent double-book test.
- RLS tests per new table (as in prior slices).
- One happy-path e2e per slice (book → email → cancel).
- Google API mocked behind a thin client interface.

## Slice roadmap

| Slice | Contents | Why this order |
|---|---|---|
| **S1 — Scheduling core** | Tables + migrations, slot engine, double-book guard, minimal services/availability admin, hosted booking page, confirmation email, legacy nav hidden | End-to-end value exists after one slice |
| **S2 — Booking lifecycle** | Client cancel/reschedule tokens + manage page, admin cancel/reschedule + bookings list, reminders via drain cron | Makes it trustworthy/usable daily |
| **S3 — Widget customization + embed** | Brand basics + live preview, embed snippet + auto-resize | Makes it distributable |
| **S4 — Google Calendar sync** | OAuth connect, FreeBusy blocking, event push | Riskiest external dependency, after core is proven |
| **S5 — Dashboard polish** | Calendar view, clients directory, stat tiles | Comfort, not correctness |

Each slice: own spec → plan → implementation PR, per repo convention.
