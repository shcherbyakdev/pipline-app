# Notifications — Design

**Date:** 2026-09-05
**Status:** Built with the spec (autonomous session, Andrii: "accepting all your
recommendation, don't ask me"); rulings open for review
**Precedent:** reminder drain (scheduling S2, `features/scheduling/reminders.ts`),
email transport seam (`lib/email/transport.ts`), billing perks
(`lib/billing/badge-toggle.ts`), premium waitlist (spec 2026-09-01), i18n D4
(emails follow the org's language)

## 1. Goal

One page, **/notifications**, where the owner controls two things:

1. **What they hear about, and where.** New booking, new request, cancellation,
   reschedule — each by email and/or as a push notification on the phones and
   computers they enable.
2. **What their clients receive.** Whether a reminder goes out before each
   booking and how long before.

"Mobile notifications" is Web Push: the app installs to a phone's home screen
and notifies like a native app. It costs nothing to send. Email stays on
Resend. SMS is designed (§9) but not built in this slice.

## 2. Providers (the cost question)

| Channel | Choice | Cost to us | Why |
|---|---|---|---|
| Push (mobile + desktop) | **Web Push, VAPID keys, `web-push` npm** | $0 | Browser standard: Chrome/Edge/Firefox on desktop and Android; iOS/iPadOS 16.4+ when the site is added to the Home Screen. No FCM, no OneSignal, no per-device fee, nothing to register. One small dependency (the RFC 8291 encryption is not a few lines). |
| Email | **Resend** (already wired) | 3,000/month free (100/day), then $20/month for 50k | Vercel Marketplace's only messaging integration; already the production transport. |
| SMS (deferred, §9) | **Twilio** | $0.0457 per SMS to Poland, alphanumeric sender free, no monthly fee | SMSAPI.pl is the same price (0.17 PLN prepaid, 49 PLN/month postpaid) with Polish invoices but no reach outside PL; Twilio wins on reach and zero fixed cost. Either way ~$0.045 a message means SMS must be a metered paid perk. |

## 3. Decisions

1. **Push on every plan.** Sending it costs nothing and a notified owner is a
   retained owner. Plan differences live in client reminders (decision 5).
2. **Two kinds of preference, two homes.** What a *person* receives lives on
   their `org_members` row (`notification_prefs jsonb`); what the *org's
   clients* receive lives on `orgs` (`notification_prefs jsonb`). Null means
   defaults, so every existing org and member behaves exactly as today. Same
   jsonb-plus-zod idiom as `widget_theme` / `page_theme`; written through
   SECURITY DEFINER RPCs (0004 doctrine: no direct member writes on `orgs` /
   `org_members`), which validate keys and values in SQL like 0068.
3. **Events and defaults.** Four owner events × two channels. Email on for
   all four (today's behaviour); push on for all four (nothing is sent until
   a device is enabled, so "on" is the useful default).
   - `newBooking` — a confirmed booking landed (public create, or accepted).
   - `newRequest` — a booking request waiting for approval.
   - `cancelled` — a client cancelled.
   - `rescheduled` — a client moved a booking.
   Admin-made changes never notify the admin (they are the actor) — unchanged.
4. **Client mails that stay mandatory.** Confirmation, request received /
   declined, cancellation and reschedule mails carry the manage link and are
   the client's record; they are not switchable. The page lists them as
   "always sent" rows without a control, so nobody looks for a switch that
   does not exist.
5. **Reminders.** `reminder.enabled` (any plan) and `reminder.leadHours` from
   a fixed set `1, 2, 3, 6, 12, 24, 48`. Free is pinned to 24 h: the plan's
   `customReminders` flag (already in `PLANS`, unread until now) unlocks the
   picker on Pro/Team. Enforced at read time in the drain (`effective lead =
   plan allows ? prefs : 24h` while `plansEnforced`), so a lapsed Pro falls
   back on its own — the badge idiom. The Free quota (first 30 bookings a
   month) is untouched and stated on the page.
6. **Reminders off = suppressed, stamped.** Same as over-quota: the drain
   stamps `reminder_sent_at` and never rescans. Re-enabling reminders affects
   bookings the drain has not reached yet, not ones it already skipped.
7. **One delivery seam for owner notices.** `notifyMembers(event)` in
   `features/notifications/notify.ts` replaces the seven provider-notice
   send sites (scheduling public/manage ×3, rentals public/hourly/manage
   ×4). It loads the org's members, composes the existing email template
   for the event, sends email and/or push according to each member's prefs,
   and never throws. The call sites shrink to one call with the structured
   payload they already had. `getProviderEmail` stays for reply-to and the
   staff-dedupe check.
8. **Push subscriptions are per user.** `push_subscriptions` (endpoint
   unique, keys, user agent, org) with RLS "own rows" and explicit grants;
   the seam reads them as service_role. A 404/410 from the push service
   deletes the row. Text follows the org's language (D4, same as provider
   mails); the payload is `{ title, body, url, tag }` and the service worker
   (`public/sw.js`) shows it and opens `url` on click.
9. **Installable app.** `app/manifest.ts` (standalone, start at /bookings),
   `app/apple-icon.tsx`, and a generated icon route for the manifest. The
   favicon is untouched. The page tells iPhone users to add to Home Screen
   first when `PushManager` is missing.
10. **Navigation.** `/notifications` is a top-level route in the sidebar's
    account group, before Settings, bell icon. `notifications` joins the
    reserved handles (app + SQL mirror, 0066 idiom).
11. **Save model.** Every control autosaves (optimistic, snaps back and
    toasts on failure) — the services row-switch idiom. No Save button.
12. **Staff notices unchanged.** `sendStaffNotice` (team orgs, `staff.email`)
    keeps its current rule; staff have no login and no preferences yet.
13. **Configuration.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
    `VAPID_SUBJECT` in env. Absent → push is "not set up" on the page and
    silently skipped by the seam; email is unaffected. Unlike the email
    transport this does not throw: a missing optional channel must not break
    a booking.

## 4. Data

```sql
alter table orgs        add column notification_prefs jsonb;   -- null = defaults
alter table org_members add column notification_prefs jsonb;   -- null = defaults

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id  uuid not null references orgs(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
```

Shapes (zod in `features/notifications/prefs.ts`, mirrored by the RPCs):

```ts
MemberPrefs = { [event in newBooking|newRequest|cancelled|rescheduled]: { email: boolean; push: boolean } }
OrgPrefs    = { reminder: { enabled: boolean; leadHours: 1|2|3|6|12|24|48 } }
```

RPCs: `update_member_notification_prefs(p_org_id, p_prefs)` (own row only),
`update_org_notification_prefs(p_org_id, p_prefs)` (member of the org).

## 5. Delivery

**Owner notices.** Call site → `notifyMembers({ orgId, event, ...payload,
idempotencyKey })`. For each `org_members` row: email address via
`auth.admin.getUserById` (as `getProviderEmail` does today), prefs parsed with
defaults; email through `selectTransport()` with the existing template
(`providerNewBookingEmail` for newBooking/newRequest, `providerCancelledEmail`,
`providerRescheduledEmail`); push through `sendPush(userId, payload)`. Each
channel in its own try; a failure is logged, never thrown.

**Push.** `features/notifications/push.ts`: `pushConfigured()`,
`sendPush(userId, payload)` → `web-push` per subscription, `TTL` one day,
delete on 404/410. `sendTestPush` from the page proves a device works.

**Reminders.** `runReminderDrain` selects `orgs(notification_prefs)` with the
rest, widens the query bound to the maximum lead (48 h) and asks a per-org
memo `reminderPolicyFor(orgId, rawPrefs)` → `{ enabled, leadMs }`. The route
injects plan gating (`customReminders` entitlement while `plansEnforced`);
tests and scripts get the prefs as written. `decideReminder` takes `leadMs`
and `disabled`. Candidates are read up to 200 so "wait" rows of short-lead
orgs cannot starve due rows behind them; sends per tick stay capped at 25.

## 6. Page

`/notifications`, max-w-2xl like Settings, two groups:

**You**
- *Push notifications* card: status line (enabled on this device / not
  enabled / not supported here / not set up), "Enable on this device",
  devices list (browser + date, remove), "Send a test". iOS hint when
  unsupported.
- *What you hear about* card: four rows, each with Email and Push switches.

**Your clients**
- *Reminders* card: switch, lead-time select (Pro chip + upgrade link when
  the plan pins it), Free-quota hint while plans are enforced.
- *Always sent* card: the five mandatory mails as plain rows.

Both languages (`notifications.*` in `messages/en.json` / `uk.json`); push
texts under `notifications.push.*`.

## 7. Testing

- `prefs.test.ts`: parse/defaults/effective lead, plan pin.
- `reminders.test.ts`: lead from prefs, disabled → suppress + stamp, wait
  rows do not consume the send cap.
- `notify.test.ts`: fake transport + fake push sender; prefs gate each
  channel; a throwing channel does not stop the other or the caller.
- Integration (local Supabase): push_subscriptions RLS (own rows only),
  both RPCs reject foreign orgs and bad shapes.
- Browser QA: enable push on desktop Chrome (localhost is a secure
  context), receive a test, toggle a pref, change lead on Pro vs Free.

## 8. Plan split

| | Free | Pro | Team |
|---|---|---|---|
| Owner email notices | ✓ | ✓ | ✓ |
| Owner push notices | ✓ | ✓ | ✓ |
| Client reminders | first 30 bookings/month, 24 h | unlimited, 1–48 h | unlimited, 1–48 h |
| SMS reminders (§9) | — | 100/month included | 300/month included |

## 9. Deferred: SMS to clients (N2)

Not built. The design, so the next slice is a build, not a debate:

- **Provider:** Twilio Programmable Messaging, alphanumeric sender (org name,
  ≤ 11 chars, fallback "Booklo"); $0.0457/segment to PL; GSM-7 = 160 chars,
  Polish/Ukrainian diacritics force UCS-2 = 70 chars, so templates strip
  diacritics or stay short. Env `TWILIO_ACCOUNT_SID/AUTH_TOKEN/SENDER`.
- **Data:** `bookings.client_phone` (E.164) + `clients.phone`; optional phone
  field on the public form (required only while the org has SMS reminders on).
- **Prefs:** `orgs.notification_prefs.reminder.sms: boolean` (Pro/Team).
- **Metering:** `sms_sends(org_id, booking_id, sent_at, segments)`; monthly
  count against the plan's `smsPerMonth`; over cap → email only, never a
  surprise bill. Cost ceiling: Pro 100 × $0.0457 ≈ $4.6 of a $12 plan.
- **Consent:** transactional only, about the booking the client made.

## 10. Deferred: second reminder (N3)

"24 h before and again 1 h before." Needs a second stamp column
(`reminder2_sent_at` + attempts) and the claim/rollback loop generalised over
the two; `decideReminder` is already pure. Page gains one more select.
