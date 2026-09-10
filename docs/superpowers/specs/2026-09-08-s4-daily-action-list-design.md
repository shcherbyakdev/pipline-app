# S4 — Daily action list

Date: 2026-09-08. Roadmap slice S4 (`2026-09-07-studio-ops-roadmap-design.md`; order fixed by `2026-09-07-d1-decision.md` §5: S1 → S2 → S3 → S7 → **S4** → S6 → S8). Builds on S2 holds (0079/0080), S3 fees (0081) and S7 charges + balance (0082). Design approved in chat 2026-09-08 (three choices and five rulings below).

## Goal

Every morning the studio sees **one list of what still needs a human**: requests waiting for approval, holds about to lapse, balances still owed after a session. The list is the Overview page's first block, and the same list reaches every member's phone once a day as a **digest** (email + push) through the notification seam PR #128 built. Nothing on the list is new state — the three sections are three queries over statuses S2, S3 and S7 already write.

## Choices (2026-09-08)

1. **Sections: holds expiring + balances due**, beside the existing requests inbox. Rejected for this slice: "today's sessions" (a read-only list with an ends-in marker), "outstanding cancellation fees" on cancelled rows (the write-off RPC only accepts confirmed rows, so it needs its own action path). **"Changes to confirm" is dropped from S4** because no such state exists: S3 applies a reschedule immediately and turns the consequence into money (`2026-09-07-s3-change-consequences-design.md` §"The move goes through"); the nearest real thing is a fee outstanding, which the balance formula already carries.
2. **Morning digest, push + email.** One notice per org per local day at 08:00, sent by the existing 15-minute drain, only when the list is non-empty, switchable per member and channel like every other member event. Rejected: push only; in-app only; per-event notices (hold expired / session ended with a balance) — more noise, no single morning list.
3. **Inline actions + a link to the day.** Rows carry the one-call actions that already exist (mark paid, send balance link, write off with a note) and a quiet "Open" that lands on the bookings page in Day view on that date. Rejected: a `?booking=<id>` deep link that opens the detail dialog (routing plumbing in three calendar mounts), or both.

## Rulings

4. **The list leads the page.** Requests, holds, balances render above the year heatmap. This reverses the 2026-09-01 ruling ("the year glance leads the page; requests follow") because Overview is now the studio's action screen, not a glance. Empty sections still render nothing (the 2026-08-31 approval spec §4 rule: an empty box every day is worse than silence). When all three are empty the heatmap is first, as today. **Amended 2026-09-10:** the heatmap leads again, always (the 2026-09-01 order). It is the only section that is always on the page, so leading with the list made the page's shape depend on the day; the list follows it and still renders nothing when empty.
5. **Holds window = next 24 hours**, not "before local midnight". Rows print the deadline, so "expiring soon" needs no timezone edge cases, and the 08:00 digest naturally covers the studio's day. A hold whose deadline has passed but which the drain has not yet flipped (≤ 15 min lag) shows as "lapsed" and keeps its Mark paid button — `mark_booking_paid` on a lapsed-but-still-`pending_payment` row is the same cash path the detail dialog offers.
6. **Balances window = ended within the last 30 days**, balance > 0, cap 50, most recently ended first. Matches S7 ruling 9 (a balance link can only be (re)sent within 30 days after the end). Older balances stay visible on the booking itself. Consequence, accepted: a studio that takes cash at the venue sees every ended session here until it clicks Mark paid — that is the settle-or-write-off workflow the concept brief asks for, and the window bounds the noise.
7. **The sidebar badge stays requests-only** in this slice. Folding holds and balances into it is a follow-up on the same RPC (one count query instead of three).
8. **Digest hour is fixed at 08:00 org-local**, no setting. Members switch email or push off in the notifications matrix; the org cannot move the hour yet.
9. **One loader, two clients.** The page (user client, RLS) and the drain (admin client) call the same `loadDailyList(db, orgId, now)`; the org filter is always explicit so the two paths cannot diverge.
10. **The balance is computed in SQL, never re-derived in TS for a list.** S7 ruling 5 made `booking_balance_cents` authoritative; the list RPC calls it, bounded by the 30-day window, and hands ids + balance to the app. Rejected: widening the booking columns and scanning every ended booking with the TS twin.
11. **Timezone math for "is it 08:00 there yet" lives in SQL** (`digest_due_orgs()`), so a tick asks one question and gets the due orgs back, instead of scanning every org and re-deriving local dates in TS.

## What exists and is reused

- **Requests inbox** — `src/features/scheduling/components/requests-inbox.tsx` (`RequestsInbox`, `RequestRow`, `DeclineRequestDialog`), fed by `listPendingRequests()` (`src/features/scheduling/queries.ts`). Its `<li>` layout becomes the shared row shell.
- **Holds** — `bookings.status = 'pending_payment'` + `hold_expires_at` (0079, CHECK `bookings_hold_ck`, partial index `bookings_hold_expires_idx`); `runHoldExpiry` (`src/features/payments/hold-expiry.ts`) flips lapsed holds every 15 min and mails the client; `formatUntil` + `bookings.hold.until` / `bookings.hold.lapsed` copy; `markBookingPaid({ id })` (`src/features/scheduling/booking-actions.ts`) → `mark_booking_paid` (0079/0082: hold → deposit row + confirm).
- **Balances** — `booking_balance_cents(uuid)` (0082, service_role only), TS twin `balanceCents` (`src/features/payments/settlement.ts`, lockstep-tested); `sendBalanceLink({ id })`, `writeOffBooking({ id, note? })` (`src/features/payments/actions.ts`); `canCollect = active payment account && client_email` (`loadBookingSettlement`); `hasActivePaymentAccount(orgId)` (`src/features/payments/queries.ts`); `bookings.charges.*` labels (`balanceDue`, `markPaid`, `sendLink`, `writeOff`, `writeOffNote` …) and `bookings.markPaid.*` toasts.
- **AdminBooking** (`queries.ts:215`) already carries `depositCents`, `holdExpiresAt`, `paidCents`, `refundedCents`, `feeCents`, `clientEmail`, `rangeMode`, `rentalUnitId`; `toAdminBooking` + `BOOKING_COLUMNS` map any id list to rows; `whenLineFor` prints the slot.
- **Notifications** — `notifyMembers(input, deps)` (`src/features/notifications/notify.ts`: members × prefs × channels, org-locale email rendered once, push with `tag = idempotencyKey`, never throws); `MEMBER_EVENTS` / `parseMemberPrefs` (tolerant) / `DEFAULT_MEMBER_PREFS` (`prefs.ts`); `update_member_notification_prefs` (0075) validating the same keys in SQL; the matrix UI `components/event-matrix.tsx`; `emailTranslators(locale)`; push copy under `emails.push.*`.
- **Drain** — `POST /api/scheduling/drain` (`src/app/api/scheduling/drain/route.ts`, Bearer `SCHEDULING_DRAIN_SECRET`, `maxDuration 60`), four isolated phases, the Cloudflare Worker cron `*/15 * * * *` (`workers/cron`). The claim-update idiom (`reminders.ts`, `hold-expiry.ts`): select candidates, update-with-guard, act on what the update returned.
- **Bookings page** — `/bookings?view=day&date=YYYY-MM-DD` (`src/app/(dashboard)/bookings/page.tsx`: `view` ∈ day/week/month/timeline, `date`).
- `orgs.timezone`, `orgs.locale`, `orgs.name` (`src/features/orgs/queries.ts`); `dateInZone` (`src/features/scheduling/slots.ts`); `formatMoney` (`src/lib/money.ts`); `env.NEXT_PUBLIC_APP_URL` for the digest's Overview link.

## Data model (migration `0083_daily_list`, additive — no one-window deploy)

### `orgs`

- `digest_sent_on date null` — the org-local date of the last digest claim. Written by the drain (admin) through the claim update; null on every existing row, which means "never sent": an existing org becomes due at the first tick past 08:00 local after deploy (so on deploy day an org with actionable rows gets its first digest that afternoon, once). Only the service role can write it: `orgs` has no UPDATE grant for `authenticated` (0004).

### `list_balances_due(p_org_id uuid, p_since timestamptz, p_limit int default 50)`

`returns table (id uuid, balance_cents int)`, `language sql stable security definer set search_path = ''`.

```sql
select s.id, s.balance_cents from (
  select b.id, b.ends_at, public.booking_balance_cents(b.id) as balance_cents
  from public.bookings b
  where b.org_id = p_org_id
    and (auth.role() = 'service_role' or p_org_id in (select public.user_orgs()))
    and b.status = 'confirmed'
    and b.ends_at <= now()
    and b.ends_at >= p_since
) s
where s.balance_cents > 0
order by s.ends_at desc
limit greatest(1, least(p_limit, 200));
```

Gate: a member of the org or the service role; anyone else gets zero rows (not an error — the page's loader is the only authenticated caller and it only ever passes its own org). `revoke all … from public, anon`; `grant execute … to authenticated, service_role`. The balance function is called once per candidate row inside the 30-day window; a studio's month is at most a few hundred rows.

### `digest_due_orgs()`

`returns table (id uuid, name text, timezone text, locale text, local_date date)`, `language sql stable security definer set search_path = ''`.

```sql
select o.id, o.name, o.timezone, o.locale,
       (now() at time zone o.timezone)::date as local_date
from public.orgs o
where extract(hour from now() at time zone o.timezone) >= 8
  and (o.digest_sent_on is null or o.digest_sent_on < (now() at time zone o.timezone)::date)
order by o.digest_sent_on nulls first, o.id
limit 25;
```

`revoke all … from public, anon, authenticated, service_role; grant execute … to service_role`. The hour is a literal here and a constant in TS (`DIGEST_LOCAL_HOUR = 8`) documented as the same number; ruling 8 says it is not a setting yet.

### `update_member_notification_prefs`

Re-created with `'dailyDigest'` added to the accepted key list (0075 line 74's `not in (…)` check). Everything else byte-identical. Older app builds keep working: they never send the key, and `parseMemberPrefs` fills it with the default on read.

Drizzle: `orgs.digest_sent_on` added to `src/db/schema/*` where `orgs` lives; the two functions are SQL-only like S7's.

## Behaviour

### Loader — `src/features/scheduling/daily-list.ts`

```ts
export type BalanceDue = AdminBooking & { balanceCents: number };
export type DailyList = { requests: AdminBooking[]; holds: AdminBooking[]; balances: BalanceDue[] };
export const HOLDS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BALANCES_WINDOW_DAYS = 30;
export const LIST_CAP = 50;
export async function loadDailyList(db: SupabaseClient, orgId: string, fallbackTitle: string, now = new Date()): Promise<DailyList>
```

- `requests`: `status = 'pending' and starts_at > now`, `org_id = orgId`, oldest start first — today's `listPendingRequests` body moves here and that function is deleted (the Overview page is its only caller; `countPendingRequests` stays for the badge).
- `holds`: `status = 'pending_payment' and hold_expires_at <= now + 24h`, `org_id = orgId`, `order hold_expires_at asc`, `limit 50`. Lapsed-not-yet-flipped rows (`hold_expires_at < now`) are included by construction.
- `balances`: `db.rpc("list_balances_due", { p_org_id, p_since: now − 30 days, p_limit: 50 })`, then one `.in("id", ids)` select with `BOOKING_COLUMNS` and `toAdminBooking`, re-ordered to the RPC's order, each row zipped with its `balance_cents`.
- The three queries run in `Promise.all`. Read errors throw (the page's error boundary, the drain's per-org try).

### Overview page

`src/app/(dashboard)/overview/page.tsx` calls `loadDailyList(userClient, orgId, fallbackTitle, now)` and `hasActivePaymentAccount(orgId)` next to the existing stats/staff queries, and mounts `<DailyList list timeZone canCollectOnline />` **below** the Activity section (ruling 4 as amended 2026-09-10). `listPendingRequests` disappears from the page.

### Components — `src/features/scheduling/components/daily-list.tsx` (client)

- `ActionRow({ title, detail, children })` — the `<li>` shell lifted out of `RequestRow` (title line, one truncated detail line with `title=` for hover, actions wrapping under on phones). `RequestRow` uses it; nothing else about the inbox changes.
- `DailyList` renders, in order: `RequestsInbox` (unchanged), `HoldsExpiring`, `BalancesDue`. Each section is `h2` + count, `ul.bg-card.divide-y.rounded-xl.border`, and returns `null` when its list is empty.
- **Hold row.** Title: client name. Detail: `whenLineFor` slot · space (with unit) · deposit `formatMoney(depositCents)` · `bookings.hold.until {time}` via `formatUntil`, or `bookings.hold.lapsed` when the deadline has passed. Actions: **Mark paid** (primary, `markBookingPaid({ id })`, toasts from `bookings.markPaid.*`, `router.refresh()`), **Open** (ghost link).
- **Balance row.** Title: client name. Detail: slot · space · **`bookings.charges.balanceDue {amount}`**. Actions: **Mark paid** (primary, two-click confirm with `bookings.charges.markPaidConfirm` exactly as the charges block does, then `markBookingPaid({ id })` — on a confirmed booking this records the whole balance, S7 decision 4; toast `bookings.charges.paid`), **Send link** (`sendBalanceLink({ id })`, toast `bookings.charges.linkSent`, rendered only when `canCollectOnline && booking.clientEmail`), **Write off** (opens `WriteOffDialog`: optional note ≤ 500, destructive confirm labelled `bookings.charges.writeOffConfirm`, `writeOffBooking`, toast `bookings.charges.writtenOffDone`; same skeleton as `DeclineRequestDialog`), **Open**.
- **Open** = `<Link href={`/bookings?view=day&date=${dateInZone(startsAt, timeZone)}`}>` styled as a ghost button; label `overview.open`.
- Accessible names disambiguate repeated buttons the way the inbox does: `overview.markPaidFor {name}`, `overview.sendLinkFor {name}`, `overview.writeOffFor {name}`, `overview.openFor {name}`.
- Every action is a `useTransition` + toast + `router.refresh()`; a row that succeeded disappears on the next render because its query no longer matches.

### Digest — `src/features/notifications/digest.ts`

```ts
export const DIGEST_LOCAL_HOUR = 8; // mirrors digest_due_orgs()
export async function runDailyDigest(deps: { db: SupabaseClient; transport?: EmailTransport; push?: PushFn; now?: Date }): Promise<{ sent: number; skipped: number; failed: number }>
```

Per tick:

1. `db.rpc("digest_due_orgs")` → up to 25 orgs with `local_date`.
2. For each org, the **claim**: `update orgs set digest_sent_on = local_date where id = org.id and (digest_sent_on is null or digest_sent_on < local_date)` `.select("id")`. No row back → another tick won; continue.
3. `loadDailyList(db, org.id, now, fallbackTitle)` where `fallbackTitle` comes from the org-locale email translator (the same "Booking" word the drain's other mails use).
4. All three empty → `skipped++` (the stamp already stands, so the org is not re-asked until tomorrow).
5. Else build the notice and call `notifyMembers({ event: "dailyDigest", orgId, idempotencyKey: `digest:${org.id}:${local_date}`, requests, holds, balances }, { db, transport, push })`; `sent++`.
6. Any throw inside one org's step → `console.error("[digest] …")`, `failed++`, next org. The stamp stays: a failed digest is not retried the same day (a retry storm every 15 minutes against a broken transport is worse than one missed morning; the drain summary and the Worker's healthcheck make the failure visible).

Rows are pre-formatted strings, in the **org's** locale and timezone, so `notifyMembers` stays a renderer:

```ts
export type DigestRow = { clientName: string; whenLine: string; note: string }; // note = deposit + until | balance amount | service/staff
```

### `notifyMembers` changes (`notify.ts`, `prefs.ts`)

- `MEMBER_EVENTS` → `[…, "dailyDigest"]`; `memberPrefsSchema` and `DEFAULT_MEMBER_PREFS` gain the key (`{ email: true, push: true }`).
- `MemberNotice` gains `{ event: "dailyDigest"; requests: DigestRow[]; holds: DigestRow[]; balances: DigestRow[] }`.
- `emailFor()` → `dailyDigestEmail(mail.t, { sections, overviewUrl: `${env.NEXT_PUBLIC_APP_URL}/overview` })`.
- Push: `title = t("push.dailyDigest.title")`, `body = t("push.dailyDigest.body", { count })` where `count = requests + holds + balances`; `pushUrlFor("dailyDigest") = "/overview"`.
- `replyTo` is undefined for the digest (there is no single client to answer).
- The idempotency key per member stays `${key}:${userId}` when there is more than one member — unchanged rule.

### `dailyDigestEmail` (`src/features/scheduling/templates.ts`)

Subject `emails.digest.subject {count}` ("3 things need you today"). Body: lead `emails.digest.lead`, then for each non-empty section a heading (`emails.digest.requests {count}` / `holds` / `balances`) and one line per row `clientName — whenLine — note`; a link `emails.digest.open` to Overview; footer `emails.digest.footer` ("You get this once a day while something is waiting. Turn it off under Notifications."). Same inline-style skeleton as `providerNewBookingEmail`; text twin joins the same lines.

### Drain route

Phase 5 in `route.ts`, in its own try like holds:

```ts
let digest: Awaited<ReturnType<typeof runDailyDigest>> | { error: string };
try { digest = await runDailyDigest({ db: admin, transport: selectTransport() }); }
catch (error) { console.error("[digest] tick failed:", error); digest = { error: "digest failed" }; }
return Response.json({ ...summary, calendar, inbound, holds, digest });
```

### Notifications page

`event-matrix.tsx` iterates `MEMBER_EVENTS`, so the new row appears once its label exists: `notifications.events.dailyDigest` ("Morning list — once a day at 08:00 while something is waiting"). The matrix has flat labels, no descriptions; the explanation rides in the label.

## i18n (en, uk, pl — the parity test enforces all three)

- `overview`: `holds.title`, `balances.title`, `open`, `openFor`, `markPaidFor`, `sendLinkFor`, `writeOffFor`, `writeOffTitle`, `writeOffBody`, `writeOffNote`, `writeOffNotePlaceholder`.
- `emails`: `digest.subject`, `digest.lead`, `digest.requests`, `digest.holds`, `digest.balances`, `digest.open`, `digest.footer`; `push.dailyDigest.title`, `push.dailyDigest.body`.
- `notifications`: `events.dailyDigest`.
- Reused as-is: `bookings.requests.*`, `bookings.hold.until`, `bookings.hold.lapsed`, `bookings.charges.balanceDue`, `bookings.charges.markPaid`, `bookings.charges.markPaidConfirm`, `bookings.charges.paid`, `bookings.charges.sendLink`, `bookings.charges.linkSent`, `bookings.charges.writeOff`, `bookings.charges.writeOffConfirm`, `bookings.charges.writtenOffDone`, `bookings.markPaid.*` (hold rows), `bookings.fallbackTitle`.
- Forbidden-word lists apply (en: rental/offering/skip; pl: wynaj/pomiń; uk: оренда/офер/пропустити).

## Tests

**Unit** (`npm test`):
- `notify.test.ts`: `dailyDigest` renders the email once, pushes `/overview` with the count body, honours `prefs.dailyDigest.{email,push}`, no `replyTo`.
- `prefs.test.ts`: parity of `MEMBER_EVENTS` with the SQL key list in 0083 (the existing assertion, re-pointed at the new migration); tolerant parse of a four-key row yields `dailyDigest` defaults.
- `messages.test.ts`: runs as is over the new keys.

**Integration** (`npm run test:integration`, local stack):
- `src/features/scheduling/daily-list.integration.test.ts` — one org seeded with: a pending request (in), a pending request in the past (out), a hold at +2 h (in), a hold at −5 min not yet flipped (in, first), a hold at +30 h (out), an ended confirmed booking with `paid = 0` (in, balance = price), an ended booking with a charge and a matching balance payment (out), an ended booking fully written off (out), a booking ended 40 days ago unpaid (out), a future confirmed booking unpaid (out), a stranger org's ended unpaid booking (out). Asserts the three arrays' ids, order and `balanceCents`, once through the admin client and once through an authenticated member client. `list_balances_due` called by an authenticated non-member returns zero rows.
- `src/features/notifications/digest.integration.test.ts` — `digest_due_orgs()`: an org in a timezone where it is before 08:00 is absent, one after 08:00 with a null stamp is present, one already stamped for its local date is absent, one stamped yesterday is present. `runDailyDigest` with injected transport + push: sends once for an org with a hold and a request, the second run the same tick sends nothing (claim), an org with an empty list is stamped and counted `skipped`, a member with `dailyDigest.email = false` gets push only, the idempotency key is `digest:<org>:<date>`.
- Existing `hold-expiry`, `reminder-drain`, `notifications` integration tests unchanged and green.

**QA** (scripted Playwright, per the S7 recipe): a hold row → Mark paid → row gone, booking confirmed; a balance row → Write off with note → row gone, detail dialog shows "Written off"; Send link hidden when the org has no active payment account; Open lands on Day view of that date; `npm run scheduling:drain` at a forced hour sends one Mailpit mail + one push and stamps the org.

## Security

- `list_balances_due` gates on `user_orgs()` or `service_role`; it exposes nothing `booking_balance_cents` would not for the org's own rows, and the balance function stays service-role only.
- `digest_due_orgs` is service-role only; `digest_sent_on` is written only by the drain (no member UPDATE path on `orgs`).
- Row actions call the existing org-gated server actions / definer RPCs (`mark_booking_paid`, `write_off_booking`, `rotate_booking_token`); no new write path.
- The drain phase runs under the same Bearer secret; no new endpoint.

## Deferred (stated, not silent)

Badge = requests + holds + balances · digest hour setting · "today's sessions" with an ends-in marker · outstanding fees on cancelled rows (needs `write_off_booking` to accept cancelled) · `?booking=<id>` deep link · per-event hold-expired notice to members · a "Refund overpayment" row for negative balances · SMS.
