# S2 — Holds + collection (Stripe Connect, direct charges)

Date: 2026-09-07. Roadmap slice S2 (`2026-09-07-studio-ops-roadmap-design.md`; order and rail fixed by `2026-09-07-d1-decision.md` §4–5; rail facts from `docs/superpowers/research/2026-09-07-competitor-and-rails-check.md` §B). Was H4 in the 2026-08-24 pivot roadmap. Design approved in chat 2026-09-07.

## Goal

When an offering's H3 deposit policy says money is due, the booking is **held** for a short window and **confirmed by payment**: the slot is blocked under the same EXCLUDE that protects confirmed bookings, the client pays the deposit through Stripe Checkout (P24, BLIK, cards) on the **studio's own Stripe account**, a webhook confirms the booking, and an unpaid hold is released automatically. The studio is the merchant of record; Booklo never holds client money and takes no fee on the payment. Cancellations that H3 already allows refund the deposit in full. Public pages carry the legal footer the P24 capability requires.

## Rulings (2026-09-07)

1. **Full Stripe dashboard** on the connected account (Stripe's SaaS pattern): `dashboard: 'full'`, `fees_collector: 'stripe'`, `losses_collector: 'stripe'`. The studio pays Stripe's sticker fees itself, Stripe carries negative balances, Booklo pays nothing per account. Express dashboard (9 zł per active account per month) rejected.
2. **Approve, then pay.** When an offering requires approval and a deposit, the request flows as today; acceptance starts the hold and sends the "pay by" mail. No money moves on a decline.
3. **Automatic full refund in S2.** A client self-cancel outside the window and an admin cancel (checkbox, on by default) refund `paid_cents − refunded_cents` on the connected account. Inside the window the client still cannot self-cancel (H3). Tiers and partial refunds are S3.
4. **`/payments` page** in the Configure group: Stripe card, hold window, legal identity. Not a card on `/integrations`.
5. **Deposit = prepayment.** H3's reading of `deposit_type='fixed'` on an unpriced offering as "damage deposit at the venue" is dropped: any `deposit_cents > 0` is collected online when the org's account is active. (No org has shipped on H3's reading.)
6. **Pull, don't push, for account status.** No account-level webhooks (v2 accounts emit thin events through Event Destinations — a second delivery system for no S2 gain). The account is retrieved on every `/payments` load and on return from onboarding; `payment_accounts.status` is the cached answer the create path reads.
7. **Hold expiry is a stored deadline flipped by the drain**, unlike the computed expiry of `pending` requests (0062). The drain runs every 15 minutes, so a lapsed hold can block its slot up to 15 minutes longer. Accepted for pilots; the upgrade is a sweep inside the create RPCs (`ponytail:` comment at the drain phase).
8. **Lazy Checkout sessions.** No session is created at booking time. One route, `GET /booking/[token]/pay`, creates-or-reuses the session on click and redirects. The widget panel, the manage page and the "pay by" mail all link there; from the embed it opens in a new tab, exactly as "View booking" already does (Checkout refuses to render in an iframe).
9. **Zero application fee**, no platform revenue on payments (pitch against per-transaction taxes; unchanged from the pivot roadmap).

## What exists and is reused

- H3 (0057/0058): `deposit_type/deposit_value/cancel_window_min` on `rental_offerings`; `rental_deposit_cents` in SQL; `bookings.price_cents/currency/deposit_cents`; the cancel-window sentinel in `cancel_booking` (0070). S1 (0078): `bookings.lines/people` snapshot; `deposit_cents` derived from the itemised total.
- Approval (0062/0063): the `pending` status, the widened EXCLUDE recipe with its free-check helpers re-created in lockstep, `accept_booking`/`decline_booking`, ghost rendering in the calendar/timeline, `BookingConfirmed`'s `pending` variant.
- The drain: `src/app/api/scheduling/drain/route.ts` (three phases, each try/caught; Bearer secret; Cloudflare Worker cron `*/15`), the claim idiom in `src/features/scheduling/reminders.ts`.
- Billing (0042/0043): `src/lib/billing/provider.ts` vendor seam with a fake, `src/app/api/billing/webhook/route.ts` (raw body first, 503 unset secret, 401 signature, 400 malformed, 200 business unknowns), `apply_billing_event` idempotency by provider id. S2 copies the shapes into `src/lib/payments/`; it does not extend `BillingProvider` (subscription-shaped).
- `moneyInfoLines` (`src/features/rentals/pricing.ts`) — the one function every money surface reads: widget confirm step, manage page, all client and provider mails. `payAtVenue` at its tail is the line S2 replaces.
- Public footer slot: `PoweredBy` + `PublicLanguageLinks` at the bottom of `channel-page.tsx` and `src/app/booking/[token]/page.tsx`.
- Stripe SDK 22.6.1 already installed; `stripe.v2.core.accounts`, `stripe.v2.core.accountLinks`, merchant capabilities `card_payments | p24_payments | blik_payments`, `checkout.sessions.expire`, `refunds.create` all present.

## Data model (migration `0079_holds_collection`)

### `bookings`

- `status` CHECK re-created: `confirmed | pending | pending_payment | declined | expired | cancelled_by_client | cancelled_by_provider | rescheduled`.
- `hold_expires_at timestamptz null`; CHECK `status <> 'pending_payment' or hold_expires_at is not null`. Kept after the flip (history).
- `paid_cents integer not null default 0` (≥ 0), `refunded_cents integer not null default 0` (≥ 0, ≤ `paid_cents`). Maintained only by the RPCs below and the admin client; never TS-computed for display.
- Both EXCLUDE guards re-created with `status in ('confirmed','pending','pending_payment')`, and **every free-check helper 0062 re-created** (`staff_is_free`, `pick_staff_for_slot`, `rental_unit_is_free_hours`, and the rest — the plan enumerates them by grepping 0062) gets the same predicate. Same file, same discipline: a pre-check that disagrees with the constraint turns an authorised insert into a 23P01.

### `booking_payments` — the ledger of provider objects (S3 refunds and S7 charges append here)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | idempotency key for the provider call |
| `org_id`, `booking_id` | uuid fk | booking cascade |
| `kind` | text | CHECK `('deposit')` — S7 adds `balance`, `charge` |
| `provider` | text | CHECK `('stripe','fake','manual')` |
| `amount_cents`, `currency` | int > 0, text | |
| `status` | text | CHECK `('pending','processing','paid','failed','expired','refunded','refund_failed')` |
| `stripe_account_id` | text null | the connected account the session lives on |
| `checkout_session_id` | text unique null | webhook lookup key |
| `checkout_url`, `checkout_expires_at` | text, timestamptz null | reuse while open |
| `payment_intent_id`, `paid_at` | text, timestamptz null | |
| `refund_id`, `refunded_cents` | text null, int default 0 | |
| `error` | text null | last provider error, for the booking detail |
| `created_at`, `updated_at` | timestamptz | |

RLS: members `select` (`org_id in (select public.user_orgs())`); every write via `service_role` (admin client, webhook, drain) or the definer RPCs. Grants: `select` to `authenticated`, `all` to `service_role` (explicit, per the grants convention).

### `payment_accounts` — one connected account per org

`org_id uuid pk` → orgs (cascade), `stripe_account_id text not null unique`, `status text` CHECK `('onboarding','active','restricted')` default `onboarding`, `capabilities jsonb not null default '{}'` (`{card_payments:'active', p24_payments:'pending', blik_payments:'active'}` as last retrieved), `checked_at`, `created_at`. Same RLS/grants as the ledger. `active` ⇔ the merchant `card_payments` capability is `active` (direct charges require it) and no requirement is `past_due`; `restricted` when it was active and is no longer; `onboarding` otherwise. Only `active` matters to the create path.

### `orgs`

- `payment_hold_min integer not null default 60`, CHECK `in (30, 60, 180, 1440)`. One window for both entrances (instant checkout and after acceptance); the studio picks. Published practice: 30 min (MILK), 60 min (LIT HOUSE, HUGO16), 24 h (Świetlik).
- `legal jsonb not null default '{}'` — `{ legalName, address, taxId, regNo, termsUrl, privacyUrl, refundUrl }`, all optional strings; URLs must be `http(s)`. Zod-validated in TS; SQL checks `jsonb_typeof = 'object'`.
- Written through `update_org_payments(p_hold_min int, p_legal jsonb)` — definer, `authenticated`, org from `user_orgs()`, copied from `update_org_scheduling`'s shape (orgs is select-only for `authenticated`, 0004).

### RPC deltas (`create or replace`, bodies copied from their latest migration with only these edits)

- **`create_rental_booking_hours` (0078) and `create_rental_booking` (0062, nights/days)** — the status line becomes three-way; both read the org's hold window and the account status:
  ```sql
  v_pay := coalesce(v_deposit_cents, 0) > 0
       and exists (select 1 from public.payment_accounts pa where pa.org_id = v_org.id and pa.status = 'active');
  status          = case when v_off.requires_approval then 'pending'
                         when v_pay then 'pending_payment' else 'confirmed' end,
  hold_expires_at = case when (not v_off.requires_approval) and v_pay
                         then least(now() + make_interval(mins => v_org.payment_hold_min), p_starts_at) end
  ```
  Return type unchanged (uuid); callers re-read `status, hold_expires_at` as they re-read `status` today.
- **`accept_booking` (0063)** — same three-way on `pending → pending_payment | confirmed`, `hold_expires_at = least(now() + hold, starts_at)`. Return unchanged; the caller re-reads.
- **`cancel_booking` (0070)** — `pending_payment` cancels unconditionally, like `pending` (the client withdraws a hold; nothing was paid). The window rule stays for `confirmed`.
- **`reschedule_*` RPCs (0078 hourly; 0062 nights)** — refuse `pending_payment` with the existing `not found`/pending guard (pay first).
- **`resolve_booking_token` (0078)** — drop/recreate adding `hold_expires_at`, `paid_cents`, `refunded_cents`.
- **`apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int) returns text`** — new, definer, `service_role` only. Looks up the ledger row by session id. Returns `unknown` (no row), `replayed` (row already `paid`), or: marks the row `paid` (intent, amount, `paid_at`) and then, on the booking, `pending_payment → confirmed` with `paid_cents += amount` → `confirmed`; if the booking is `expired`, tries the same update inside a nested block — `exclusion_violation` → `slot_lost`; any other status → `slot_lost`. The ledger row stays `paid` on `slot_lost`; the caller refunds and marks it `refunded`.
- **`mark_booking_paid(p_booking_id uuid)`** — new, definer, `authenticated`, org-gated: `pending_payment → confirmed`, `paid_cents = deposit_cents`, inserts a `manual` ledger row. The escape hatch for a transfer received off-platform; one button.
- Migration header names this spec; footer is the `-- Rollback:` block (0078 model). **Deploy note:** signatures of `resolve_booking_token` change and five RPC bodies change — migrate and deploy the build in one window (0078 precedent).

## Provider seam — `src/lib/payments/`

```ts
export interface PaymentsProvider {
  readonly name: "stripe" | "fake";
  createAccount(input: { country: string; email: string; displayName: string }): Promise<{ accountId: string }>;
  createOnboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  getAccountStatus(accountId: string): Promise<{ status: "onboarding" | "active" | "restricted"; capabilities: Record<string, string> }>;
  createCheckout(input: CheckoutInput): Promise<{ sessionId: string; url: string; expiresAt: Date }>;
  expireCheckout(accountId: string, sessionId: string): Promise<void>;          // ignores already-expired
  refund(accountId: string, paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ refundId: string }>;
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[];              // throws on bad signature
}
```

- **Stripe** (`stripe.ts`): a second client on `STRIPE_CONNECT_SECRET_KEY` (the platform account; separate from billing's Managed-Payments keys — which Stripe account each points at is a launch-checklist item). Account: `v2.core.accounts.create` with `dashboard: 'full'`, `defaults.responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' }`, `identity.country`, `configuration.merchant.capabilities: { card_payments, p24_payments, blik_payments }` requested, `configuration.merchant.mcc: '7333'` (D1: never a rental MCC; verify in test mode — Stripe may ask for more at onboarding). Onboarding: `v2.core.accountLinks.create` with `use_case.account_onboarding.configurations: ['merchant']`. Status: `v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'requirements'] })`. Checkout: `checkout.sessions.create` **with `{ stripeAccount }`** (direct charge, the studio's branding), `mode: 'payment'`, one `price_data` line (`currency` = booking currency, `unit_amount` = deposit, product name = booking title + when), `customer_email`, `expires_at` = hold expiry clamped to Stripe's [now + 30 min, now + 24 h], `success_url` = manage URL `?paid=1`, `cancel_url` = manage URL, `metadata.booking_id/payment_id`, `locale` from the booking locale, **no `payment_method_types`** (the account's dynamic methods: P24/BLIK/cards). Refund: `refunds.create({ payment_intent, amount }, { stripeAccount, idempotencyKey })`. Webhook: `webhooks.constructEvent` with `STRIPE_CONNECT_WEBHOOK_SECRET` — a **Connect** endpoint ("listen to events on connected accounts"; the event carries `account`).
- **Fake** (`fake.ts` + a dev checkout page): mirrors `src/lib/billing/fake.ts` / `fake-emulator.ts`. `createCheckout` returns `/dev/payments/checkout?session=…`; that page offers Pay / Fail / Async-then-pay and POSTs HMAC-signed (`PAYMENTS_FAKE_SECRET`) events to the webhook. `getAccountStatus` returns `active` once the fake onboarding link is visited. Used by integration tests and local QA.
- **Env** (`src/env-schema.ts`): `PAYMENTS_PROVIDER` `'stripe' | 'fake'` (unset = payments off), `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET` (both required when `stripe`, superRefine as billing), `PAYMENTS_FAKE_SECRET` (forbidden in production, as `BILLING_FAKE_SECRET`). `paymentsConfigured()` gates the `/payments` card copy; nothing else needs it (an org cannot reach `active` without onboarding).

## Flows

**Create (widget → `createRentalBookingHours` / `createRentalBooking`).** The RPC decides the status. The action re-reads `status, hold_expires_at`; for `pending_payment` it sends the client the **payment-due** mail (pay link = the pay route, manage link) and returns `{ ok, token, outcome: 'payment', holdExpiresAt, amount }` (`pending: boolean` becomes `outcome: 'confirmed' | 'pending' | 'payment'`). No provider notice on a hold; `newBooking` fires at confirmation. No `.ics` while held.

**Pay (`GET /booking/[token]/pay?lang=`).** `resolveBookingToken` (its rate limits). Not `pending_payment`, or hold lapsed → 303 to the manage page (which explains). Else reuse the newest `pending` ledger row whose `checkout_expires_at > now() + 1 min`; otherwise create a session (`expires_at` = `min(max(hold, now+30m+30s), now+24h)`), insert the row (`pending`, url, expiry; idempotency key = row id), then 303 to the URL. Provider failure → 303 to the manage page `?pay=failed` ("Payment isn't available right now — try again in a moment"); the hold stands until it expires.

**Approve then pay.** `acceptBookingRequest` calls `accept_booking`, re-reads; `pending_payment` → payment-due mail (with the hold time) instead of the confirmation mail; `confirmed` → today's path. Decline unchanged.

**Webhook (`POST /api/payments/webhook`, billing route as template).**
- `checkout.session.completed`, `payment_status = 'paid'` → `apply_booking_payment`.
- `checkout.session.completed`, `'unpaid'` (P24 in flight) → ledger `processing`; `hold_expires_at = greatest(hold_expires_at, now() + 1 h)` while still `pending_payment` (P24 settles or fails within the hour).
- `checkout.session.async_payment_succeeded` → `apply_booking_payment`.
- `checkout.session.async_payment_failed` → ledger `failed`; the hold stands, the manage page's Pay button starts a fresh session.
- `checkout.session.expired` → ledger `expired` (the booking is the drain's business).
- Result `confirmed` → the shared **confirmation side-effects** helper (one function, three callers: create-confirmed, accept-confirmed, webhook): client confirmation mail with money lines + `.ics`, `notifyMembers({ event: 'newBooking', infoLines })`, `kickCalendarSync`, revalidate. `slot_lost` → refund in full on the connected account, ledger `refunded`, client **slot-lost** mail. `replayed` / `unknown` → 200 and a log line. 503 when the secret is unset, 401 on signature, 400 malformed, 500 only on our own failure (Stripe retries).

**Drain — fourth phase `runHoldExpiry`.** Select up to 25 `pending_payment` rows with `hold_expires_at <= now()`, claim with `update … set status = 'expired' where id in (…) and status = 'pending_payment' returning …` (exactly one drain wins a row), then per row: `expireCheckout` on any `pending`/`processing` ledger row (best effort; mark it `expired`), send the client **hold-expired** mail once (dedupe key `booking/{id}/hold-expired`). No retry path — the status flip is the durable part. Same try/catch isolation as the other three phases; `pending_payment` rows never receive reminders (the reminder scan is `status = 'confirmed'`) and never sync to Google (`sync.ts` pushes `confirmed` only).

**Cancel / refund.** Client cancel (`cancelBooking`): the RPC decides as today; afterwards, when `paid_cents > refunded_cents`, the action refunds the difference (idempotency key `{ledgerId}:refund`), updates the ledger (`refunded`, `refund_id`, `refunded_cents`) and `bookings.refunded_cents`; the cancelled mail gains the refund line. Admin cancel (`cancelBookingAdmin`): the dialog shows "Refund {amount}" (checked) when there is anything to refund; same tail. A provider failure leaves the booking cancelled, the ledger `refund_failed` + `error`, and the booking detail shows "Refund failed — refund in Stripe"; never silent. Withdrawing a hold refunds nothing (nothing was paid). A hold the admin cancels frees the slot the same way.

**Reschedule.** A hold cannot be rescheduled (pay first). A paid booking reschedules as today: total and deposit are re-snapshotted (H3/S1), `paid_cents` carries, and every surface shows "Paid X · Y due at the venue" from the new numbers. Collecting or refunding the difference is S3/S7.

**Mark as paid.** Booking detail on a hold: "Mark as paid" → `mark_booking_paid` → the confirmation side-effects helper.

## Admin

- **`/payments`** (Configure group, same `max-w-2xl` frame as Integrations/Notifications): (1) **Stripe card** — not configured on this server / *Connect Stripe* (country select, default PL, short supported list; creates the account and redirects to onboarding) / *Continue onboarding* (new account link) / *Active* with capability chips (cards · P24 · BLIK) and an "Open Stripe dashboard" link (plain `dashboard.stripe.com`; full dashboards have no login-link) / *Restricted* with "Stripe needs more information" → onboarding link. Status is refreshed on every load and on `?stripe=return`; `?stripe=refresh` mints a fresh link. (2) **Hold window** select. (3) **Legal details** form (legal name, address, NIP, REGON/KRS, Terms / Privacy / Refund-policy URLs) with a one-line note that Przelewy24 requires them on the page. Sidebar/mobile nav gain the item.
- **Bookings (list, day/week/month grid, timeline, space page):** every live query that reads `status in ('confirmed','pending')` (e.g. `rentals/queries.ts` timeline, the grids) adds `pending_payment`; history lists that name `declined` (the space page's past bookings) add `expired` beside it. `pending_payment` renders like `pending` (dashed ghost) with the label "Awaiting payment · until 14:32". Show-filter tokens unchanged.
- **Booking detail dialog:** status line + hold time; actions on a hold: Cancel (frees the slot), Mark as paid. On a paid booking: "Paid 200 zł · 400 zł due at the venue"; Cancel opens the refund checkbox. Refund-failed state shown in red with the provider error.
- Requests inbox, Overview, Notifications prefs: unchanged (S4 owns the daily list; no new member event in S2 — `newBooking` at confirmation is the notice).

## Public

- **Widget** (`BookingConfirmed`, third variant): heading "Reserved until 14:32", body "Pay {amount} to confirm. Unpaid reservations are released automatically.", primary **Pay {amount}** (link to the pay route, new tab), secondary View booking. No `.ics`.
- **Manage page:** `pending_payment` → status chip, "Reserved until 14:32", **Pay {amount}** (pay route) + Withdraw; `?paid=1` with the row still held (P24 async) → "We're confirming your payment — this page updates when Przelewy24 settles"; `?pay=failed` banner. `expired` → "This reservation expired unpaid" + link to the booking page. Paid → money lines below.
- **`moneyInfoLines`** gains states from the row: `payNow` ("Pay {amount} to confirm"), `paid` ("Paid {amount}"), `balanceAtVenue` ("{amount} due at the venue"), `refund` ("{amount} refunded — bank refunds take up to 3 business days"). `payAtVenue` stays for orgs without an active account. One edit, every surface.
- **Legal footer** (`LegalFooter`, under `PublicLanguageLinks` on the channel page and the manage page): one muted line — legal name · address · NIP … · REGON … — then Terms · Privacy · Refund policy links; renders nothing when `legal` is empty. The offering-level `terms_text` `<details>` at the confirm step stays.
- **Mails** (client): **payment due** ("Pay {amount} by {time} to confirm {title}" — hold time, Pay link, manage link; sent on create-held and on accept-held), **hold expired** ("Your reservation for {title} was released — book again" with the booking page link), **slot lost** ("We received your payment after the slot was taken — {amount} refunded"), confirmation + cancelled mails carry the new money lines. Provider: `newBooking` at confirmation with `infoLines` ("Paid 200 zł"); nothing on holds or expiries.

## i18n (en · uk · pl, keyed per the messages ratchet)

`public.units.{payNow,paid,balanceAtVenue,refund}`, `public.confirmed.{reservedUntil,payBody,pay}`, `public.manage.{status.pendingPayment,status.expired,reservedUntil,pay,withdraw,paymentProcessing,paymentFailed,expiredBody}`, `emails.{paymentDue,holdExpired,slotLost}`, `bookings.status.{pendingPayment,expired}`, `bookings.detail.{markPaid,refund,refundFailed}`, `payments.*` (page, card states, hold window, legal form), `public.legal.*` (footer labels), `errors.paymentUnavailable`. Money strings go through `formatMoney`; times through the org zone like every other hold/start time.

## Tests

- **Unit:** `moneyInfoLines` per state (unpaid hold · paid · paid + balance · refunded · no rail); the Checkout `expires_at` clamp (the hold itself is SQL, covered below); `parseWebhook` normalisation for both providers; status-label maps; `legal` zod (URL scheme).
- **Integration (DB):** create RPC three-way (no account → `confirmed`; active account + deposit → `pending_payment` with `hold ≤ starts_at`; approval → `pending`; deposit 0 → `confirmed`); an overlapping insert against a hold 23P01s; `accept_booking` → `pending_payment` when a deposit is due; `apply_booking_payment`: confirm · replay · `expired` revived · `expired` + slot taken → `slot_lost`; drain claim (two concurrent ticks, one winner; ledger `expired`); `cancel_booking` allows `pending_payment`; reschedule refuses a hold; `resolve_booking_token` returns the three new fields; `update_org_payments` RLS and CHECKs; `mark_booking_paid` org gate.
- **Integration (HTTP):** the webhook route with the fake provider — signed `completed/paid` → `confirmed` + mails sent; `async_failed` → ledger `failed`, hold intact; bad signature → 401; secret unset → 503.
- **QA recipe (in the plan):** fake provider end-to-end at localhost (scripted Playwright, per the S1 lesson); then Stripe **test mode**: `stripe listen --forward-connect-to localhost:3000/api/payments/webhook`, onboard a test connected account in PL, pay with the P24 and BLIK test flows and a test card, cancel outside the window and see the refund on the connected account, let a hold lapse and watch the drain. Real-mode verification is the launch checklist.

## Out of scope (named so nobody builds them here)

Tiered cancellation, partial refunds, refund on reschedule difference (S3) · after-session charges, balance links, card-on-file (S7) · daily action list, provider notices for holds/expiries (S4) · application fees, Express dashboard, login links · account-level webhooks / Event Destinations · invoices and receipts beyond Stripe's own · payments on the appointments channel · multi-currency (the org currency stays the presentment currency) · hour bundles, memberships.

## Launch checklist additions (not code)

Second Stripe platform account vs reusing the billing account (Managed Payments cannot be a Connect platform); Connect webhook endpoint on that account with the five Checkout events; `PAYMENTS_PROVIDER=stripe` + the two keys on Vercel; MCC 7333 acceptance and the P24/BLIK capability review on the first real onboarding; the legal footer filled for the pilot studio before requesting P24.
