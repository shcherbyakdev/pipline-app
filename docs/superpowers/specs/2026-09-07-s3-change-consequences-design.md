# S3 — Change consequences (tiered cancellation, late-change fees, partial refunds)

Date: 2026-09-07. Roadmap slice S3 (`2026-09-07-studio-ops-roadmap-design.md`; order fixed by `2026-09-07-d1-decision.md` §5). Builds on S1 (`2026-09-07-s1-pricing-rules-design.md`, migration 0078) and S2 (`2026-09-07-s2-holds-collection-design.md`, migrations 0079/0080). Design approved in chat 2026-09-07 (four decisions below).

## Goal

A space's single free-cancellation window becomes a **tiered policy** (for example: free until 72 h before, 50% until 48 h, 100% after). When a client cancels or reschedules, the tier in force at that moment decides a **fee on the booking total**; the fee is kept out of what was paid online and the rest is **refunded through Connect**, partially if need be. The client sees the consequence **before confirming** on the manage page, and both parties' emails state it. Admin cancels default to the policy but can waive or keep everything. Reschedules re-quote at the new time as today; a late move carries the tier fee onto the new booking, and money the studio now holds above the new total plus fee goes back.

## Decisions (2026-09-07, chosen from three options each)

1. **Fee base: % of the booking total, kept from what was paid.** Fee = round(total × pct / 100). What was paid online covers it first; the remainder is refunded. When the fee exceeds what was paid, the shortfall is **recorded as outstanding** on the booking (admin sees it; S7 collects it). Alternatives rejected: % of what was paid (a "100%" on a 30% deposit keeps 30%); silent write-off.
2. **Reschedule from inside a fee tier applies the tier fee as a change fee.** The move goes through, the price re-quotes at the new time, paid money carries, the fee lands on the new row. Free tier = free move, as today. Alternatives rejected: blocking self-serve reschedule inside a tier; always-free moves (keeps H3's move-far-then-cancel loophole open).
3. **Admin cancel offers per policy (default) / everything / nothing.** The dialog shows the computed consequence. Alternatives rejected: today's all-or-nothing checkbox; policy-only.
4. **Policy lives on the space**, replacing `cancel_window_min` on the same form, next to deposit and terms. Existing windows migrate to a one-tier policy. Alternatives rejected: workspace-level policy; default + override.

## Rulings

5. **Self-cancel is always allowed** for a future booking. Inside the last tier the client cancels at 100% instead of being refused (H3's `cancel_window` sentinel is retired). The slot frees up, the studio sees the fee. For a space without online payments the fee shows as outstanding in admin. (Behaviour change from H3, approved in chat.)
6. **The policy is snapshotted on the booking** at insert, like the price (S1 `lines`). A studio editing its tiers never changes the terms a client already accepted. A reschedule carries the old row's snapshot.
7. **Time of reference** is the moment of the change, measured against the booking's start: `lead = starts_at − now()`. The first tier (largest lead first) whose lead is still met gives the percentage; no tier met → 100%; empty policy → 0%.
8. **Admin moves stay free and never refund.** `p_enforce_limits = false` (both apply cores) means "the studio is acting": no limits, no fee, no settlement. The reschedule fee accumulates: a second late move adds to the first.
9. **A confirmed booking never drops back to a hold.** After a reschedule the re-snapshotted deposit may exceed what was paid; the difference is due at the venue (S7 collects online).
10. **The old `rescheduled` row is zeroed** (`paid_cents`, `refunded_cents`, `fee_cents` = 0) by the ledger-carry trigger — money lives on the live row only, so every SUM is right by construction (closes S2's deferred item). `rescheduled` joins the manage page's `DEAD_STATUSES` (S2 deferred item).
11. **Partial refunds keep the ledger row `paid`** with `refunded_cents` bumped; it flips to `refunded` only when fully returned. `refund_failed` semantics unchanged (provider refused, or a write after its refund failed → a human in Stripe).
12. **Appointments are untouched.** Services have no policy; `cancel_booking` computes no fee for them (`price_cents` null, no snapshot).

## What exists and is reused

- H3 (0057/0058): `cancel_window_min` on `rental_offerings`, the window gate in `cancel_booking` (0079 body), `formatCancelWindow` + the `freeCancellation` line in `moneyInfoLines`, the "Free cancellation until" field on `offering-form.tsx`. All replaced here.
- S1 (0078): `bookings.lines/people/price_cents` snapshot, `rental_quote_hours` (SQL) ≡ `quoteHours` (TS) lockstep test idiom (`pricing-quote.integration.test.ts`), `Line` kinds, `formatLine`. The reschedule preview quotes the candidate client-side with `quoteHours` exactly as `hourly-booking-flow.tsx` does.
- S2 (0079): `paid_cents/refunded_cents`, `booking_payments` ledger, `refundLedgerRow`/`refundBooking` (`src/features/payments/refund.ts`), `bump_booking_refunded` (least-clamped), the carry triggers `carry_booking_locale` (BEFORE INSERT) and `carry_booking_payments` (AFTER INSERT), `expireOpenCheckouts`, the admin cancel dialog's refund checkbox (`booking-detail-dialog.tsx`), `cancelBookingAdmin` (`scheduling/booking-actions.ts`, direct RLS update), the fake provider.
- Both reschedule apply cores already take `p_enforce_limits boolean` (true only from the client-token wrappers): `reschedule_rental_apply` (nights/days, base 0070) and `reschedule_rental_hours_apply` (hours, base 0078). Wrappers unchanged: `reschedule_rental_booking` (0052), `reschedule_rental_booking_hours` (0056), `_admin` twins (0039/0056).
- `getManageHourlySlots` / `getManageRangeAvailability` already return the `PublicOffering` (with `pricing`, `priceCents`, `pricingMode`) to the reschedule panels; `resolveBookingToken` already returns `lines`, `people`, `paidCents`, `refundedCents`, `startsAt`.
- `getBookingMoney` (`src/lib/booking/public.ts`) feeds every rental email's money lines; `moneyInfoLines` (`src/features/rentals/pricing.ts`) is the one function every money surface reads.

## Data model (migration `0081_change_consequences`)

### `rental_offerings`

- `cancel_policy jsonb not null default '[]'`, CHECK `jsonb_typeof(cancel_policy) = 'array'` (S1's `pricing` discipline: shape enforced by Zod at the write boundary, type by SQL).
- Shape: `[{ "beforeMin": int ≥ 0, "feePct": int 0..100 }]`, **sorted by `beforeMin` descending, unique `beforeMin`, at most 5 tiers**. `beforeMin = 0` is a legal last tier ("X% right up to the start").
- Backfill: `update … set cancel_policy = jsonb_build_array(jsonb_build_object('beforeMin', cancel_window_min, 'feePct', 0)) where cancel_window_min > 0` — "free until W" becomes free until W, then 100% (ruling 5).
- `cancel_window_min` **dropped** (with `rental_offerings_cancel_window_ck`). One-window deploy (0057's lesson): the old build selects the column.

### `bookings`

- `cancel_policy jsonb null`, CHECK `cancel_policy is null or jsonb_typeof(cancel_policy) = 'array'`. The snapshot (ruling 6). Null for appointments and for pre-S3 rows.
- `fee_cents integer not null default 0`, CHECK `≥ 0`. The consequence incurred: a cancellation fee on a dead row, an accumulated late-change fee on a live one. Written only by `cancel_booking`, the two apply cores, and `cancelBookingAdmin`.
- Backfill of `cancel_policy` for live rental rows: `update bookings b set cancel_policy = ro.cancel_policy from rental_offerings ro where ro.id = b.rental_offering_id and b.status in ('confirmed','pending','pending_payment') and b.starts_at > now()` — after the offering backfill, so future bookings keep the window their client accepted.

### Trigger deltas

- `carry_booking_locale` (BEFORE INSERT, base 0079) grows one rule: `cancel_policy` — from the old row when `rescheduled_from_id` is set (carry), else from the offering when `rental_offering_id` is set and `new.cancel_policy is null`. One place snapshots for every insert path (public create, accept, admin walk-in, both reschedule cores); no create RPC is re-issued.
- `carry_booking_payments` (AFTER INSERT, base 0079) grows one statement: `update public.bookings set paid_cents = 0, refunded_cents = 0, fee_cents = 0 where id = new.rescheduled_from_id` (ruling 10). Definer, same as today.

### SQL helper (pure, granted to `service_role` for the lockstep test — no `_test` wrapper needed, it reads no table)

```sql
create function public.cancel_fee_pct(p_policy jsonb, p_starts_at timestamptz, p_at timestamptz)
returns int language sql immutable set search_path = '' as $$
  select coalesce(
    (select (t->>'feePct')::int
       from jsonb_array_elements(coalesce(p_policy, '[]'::jsonb)) t
      where p_at <= p_starts_at - make_interval(mins => (t->>'beforeMin')::int)
      order by (t->>'beforeMin')::int desc limit 1),
    case when jsonb_array_length(coalesce(p_policy, '[]'::jsonb)) = 0 then 0 else 100 end);
$$;
```

Fee in cents, everywhere: `round(p_total * pct / 100.0)::int` in SQL, `Math.round(total * pct / 100)` in TS (identical for non-negative halves — S1's surcharge precedent).

### RPC deltas (`create or replace`, bodies copied from their latest migration with only these edits; no return type changes except `resolve_booking_token`)

- **`cancel_booking(p_token)`** (base 0079): the `confirmed`-rental window predicate and the `cancel_window` sentinel go. The UPDATE sets `status = 'cancelled_by_client'` and `fee_cents = b.fee_cents + case when b.status = 'confirmed' and b.price_cents is not null then round(b.price_cents * public.cancel_fee_pct(b.cancel_policy, b.starts_at, now()) / 100.0)::int else 0 end` (SET expressions read the OLD row: a hold or a pending request withdraws adding nothing; a late-change fee incurred earlier survives — consequences accumulate, ruling 8). Return table unchanged — the action reads the row's money afterwards (it already did a conditional currency read; that becomes one unconditional read of `price_cents, currency, paid_cents, refunded_cents, fee_cents`).
- **`reschedule_rental_hours_apply`** (base 0078) and **`reschedule_rental_apply`** (base 0070): before the old row is flipped, `v_fee := case when p_enforce_limits and v_old.price_cents is not null then round(v_old.price_cents * public.cancel_fee_pct(v_old.cancel_policy, v_old.starts_at, now()) / 100.0)::int else 0 end`. The new row's INSERT adds `fee_cents = v_old.fee_cents + v_fee` (the policy snapshot arrives via the BEFORE INSERT trigger). Return tables unchanged, so the four wrappers (`reschedule_rental_booking`, `reschedule_rental_booking_hours`, their `_admin` twins) are not touched; the client actions read the new row's money through `getBookingMoney`, which they already call for the mail.
- **`resolve_booking_token`** (base 0079): `cancel_window_min int` → `cancel_policy jsonb` (the booking's snapshot), `+ fee_cents int`. Drop + create; `anon, service_role` grants re-issued. One-window deploy, as S2.

### Rollback (in the migration footer, S2 style)

Drop `cancel_fee_pct`; recreate `resolve_booking_token` (drop + create) from 0079, `create or replace` `cancel_booking` from 0079 and both apply cores from 0078/0070; `create or replace` both carry triggers from 0079; `alter table bookings drop column cancel_policy, drop column fee_cents`; `alter table rental_offerings add column cancel_window_min int not null default 0` (+ CHECK) backfilled from the first tier's `beforeMin`; `drop column cancel_policy`.

## TypeScript

### Policy (`src/features/rentals/cancel-policy.ts`, new — the TS twin of the SQL helper)

- `CancelTier = { beforeMin: number; feePct: number }`, `CancelPolicy = CancelTier[]`.
- `cancelPolicySchema` (Zod): array ≤ 5, each `beforeMin` int 0..527040 (the existing window cap), `feePct` int 0..100; `.transform` sorts descending; `.refine` rejects duplicate `beforeMin`.
- `cancelFeePct(policy, startsAt, at)` — the mirror; `cancelFeeCents(policy, totalCents | null, startsAt, at)` → 0 when unpriced.
- `formatCancelPolicy(policy, t)` → one line or null (empty policy). Segments joined with ` · `: a `feePct = 0` tier → `policyFree` ("Free cancellation until {window} before start"), other tiers → `policyTier` ("{pct}% fee until {window} before"), a `beforeMin = 0` tier → `policyAfter` ("{pct}% after that"), and when the smallest `beforeMin > 0` a trailing `policyAfter` at 100. `{window}` via the existing `formatCancelWindow`. Replaces the `freeCancellation` line in `moneyInfoLines`.

### Money lines (`moneyInfoLines`, `src/features/rentals/pricing.ts`)

`MoneyInfo` loses `cancelWindowMin`, gains `cancelPolicy: CancelPolicy | null` and `feeCents?: number` (`formatCancelWindow` already picks days vs hours from the minute count, so no range mode is needed). Order: quote lines · total · **fee** (`cancellationFee` on a settled row, `changeFee` on a live one, only when > 0) · paid / balance (balance = `total + fee − paid`, "due at the venue") · deposit lines (unchanged) · refund (unchanged) · **policy line** (live rows only). Appointment callers pass `cancelPolicy: null` and render byte-identical.

### `getBookingMoney(bookingId)` (`src/lib/booking/public.ts`)

Drops its `cancelWindowMin` parameter; reads `cancel_policy, fee_cents, paid_cents, refunded_cents, starts_at` from the row alongside `lines, price_cents, deposit_cents, currency` and returns them (the reschedule settlement below needs the paid/fee/price triple). Its six callers (`rentals/booking-actions.ts` ×2, `rentals/manage-actions.ts`, `hourly-actions.ts`, `public-actions.ts`, `payments/confirm-effects.ts`) stop passing the window; `confirm-effects.ts` stops selecting `rental_offerings(cancel_window_min)`.

### Refund engine (`src/features/payments/refund.ts`)

- `refundLedgerRow(ledgerId, reason, deps, { bumpBooking?, amountCents? })` — refunds `min(amountCents ?? remaining, remaining)`; after the provider call the row gets `refunded_cents += amount` and `status = refunded` only when `refunded_cents = amount_cents` (ruling 11). Contract otherwise unchanged (never throws; `false` = needs a human).
- `refundBooking(bookingId, reason, deps, { amountCents? })` — walks `paid` rows with an intent, oldest first, refunding until the cap is met; `{ refundedCents, failed }` as today. No cap = everything (S2 behaviour preserved for callers that keep it).

### Consequence previews

- **Cancel (manage page, `src/app/booking/[token]/page.tsx`)**: for a `confirmed` rental with a price, compute `pct`, `fee`, `refund = max(0, paid − refunded − fee)` server-side and pass `cancelLines: string[]` (translated `public.units`) to `ManageBooking`; the cancel-confirm state renders them above the buttons. Lines: `cancelFeeNow` ("Cancelling now: {amount} fee ({pct}%)") when fee > 0; `willRefund` ("{amount} will be refunded") when refund > 0. `canCancel` is now `true` for every actionable booking; the `cancelWindowPassed` branch and key are deleted.
- **Reschedule (both panels)**: `getManageHourlySlots` and `getManageRangeAvailability` return `booking: { startsAt, priceCents, currency, paidCents, refundedCents, feeCents, cancelPolicy, people, extras }` (extras = the `extra` lines' `{ id: extraId, qty }`). On a candidate the panel computes the new total client-side (`quoteHours` for hours; `totalCents(offering, stayUnits(...))` for stays), `fee = cancelFeeCents(policy, priceCents, startsAt, now)`, and renders `changeLines(...)` (new pure helper in `pricing.ts`): `newTotal` ("New total: {amount}"), `changeFee` ("Late change fee: {amount} ({pct}%)") when fee > 0, then `willRefund` when `paid − refunded > newTotal + fee`, else `balanceAtVenue` for the remainder when > 0. Unpriced offering → no lines.

### Actions

- **Client cancel** (`scheduling/manage-actions.ts` `cancelBooking`): drop the sentinel branch; read the row's money once after the RPC; `refundBooking(id, "cancel", {}, { amountCents: max(0, paid − refunded − fee) })` (skip when 0). Client mail `infoLines`: `cancellationFee` when fee > 0, `refund` when refunded > 0. The provider notification is unchanged (its `cancelled` event carries no info lines); the studio reads the fee on the booking detail.
- **Admin cancel** (`scheduling/booking-actions.ts` `cancelBookingAdmin`): input `refund: 'policy' | 'all' | 'none'` replaces the boolean. Read the row first (`price_cents, cancel_policy, starts_at, paid_cents, refunded_cents, currency`, RLS client), then: `policy` → `fee = cancelFeeCents(...)`, refund `max(0, paid − refunded − fee)`; `all` → fee 0, refund everything; `none` → `fee = max(prior fee, paid − refunded)`, refund nothing; `policy` adds the tier fee to any prior late-change fee; `all` clears it. The UPDATE writes `status` and `fee_cents` together (same predicate as today). Return gains `feeCents`. Mail lines as the client cancel.
- **Client reschedule** (`rentals/manage-actions.ts`, both functions): after the apply RPC returns, `getBookingMoney(newId)` once; `excess = paid − refunded − (price + fee)`; when > 0, `refundBooking(newId, "reschedule", {}, { amountCents: excess })` (the ledger rows already point at the new row — 0079 carry). The rescheduled mail's money lines come from that same read (with `refundedCents` bumped by what just went back) and therefore show the fee, the balance and the `refund` line. Admin reschedule paths: unchanged.

### Admin surfaces

- **Space form** (`offering-form.tsx` + `rentals/schema.ts` + `rentals/actions.ts`): the one "Free cancellation until" input becomes a **tiers editor**: rows of `[before N] [hours | days per range mode] [fee %]`, add row (max 5) / remove row, and a fixed trailing line "Less than {smallest} before start: 100%" (hidden when the smallest tier is `beforeMin = 0`, whose own row reads "right up to the start"). Serialised as hidden JSON, parsed with `cancelPolicySchema`. Hours for `hours` spaces, days otherwise (today's convention, converted at the boundary as `cancelWindowMin` was).
- **Booking detail** (`booking-detail-dialog.tsx`, `scheduling/queries.ts` +`cancel_policy, fee_cents`): shows `fee` ("Fee: {amount}") when > 0 and `feeOutstanding` ("{amount} outstanding") when `fee > paid − refunded`. The cancel confirm gets the three-way choice on the existing `SegmentedTabs` (per policy · everything · nothing) with the per-policy line computed client-side ("Policy keeps {kept}, refunds {refund}"); only "everything / nothing" when there is no policy fee; nothing at all when nothing was paid and there is no fee (plain cancel as today).
- **Requests inbox / lists**: unchanged (fees show on the detail).

### Public surfaces

- Widget confirm step (`booking-money-summary.tsx`): the policy line via `moneyInfoLines` (offering `cancelPolicy` instead of `cancelWindowMin`); `preview-catalog.ts` gets `cancelPolicy: []`.
- Manage page: money lines from the snapshot (`cancelPolicy`, `feeCents` from the token resolve), cancel preview above, reschedule previews inside the panels.

### i18n (en · uk · pl, keyed per the messages ratchet)

Added under `public.units`: `cancellationFee`, `changeFee`, `cancelFeeNow`, `willRefund`, `newTotal`, `policyFree`, `policyTier`, `policyAfter`. Under the admin space form: `form.cancelPolicy`, `form.tierBefore`, `form.tierFee`, `form.tierAfter`, `form.tierUpToStart`, `form.addTier`, `form.removeTier`. Under bookings: `fee`, `feeOutstanding`, `cancel.refundPolicy`, `cancel.refundAll`, `cancel.refundNone`, `cancel.policyLine`. Removed: `errors.cancelWindowPassed`, `public.units.freeCancellation`, `form.cancelWindowHours`, `form.cancelWindowDays`, `form.noWindow`. `SAME_IN_EVERY_LOCALE` grows only if a label is a bare number/symbol.

## Tests

- **Lockstep (integration)**: `cancel_fee_pct` ≡ `cancelFeePct` over a table of policies × instants: empty, one tier at/just inside/just outside the boundary, three tiers, `beforeMin = 0` last tier, none met → 100, unsorted input rejected by Zod (SQL is order-independent by construction). Fee rounding at a half-cent case.
- **Integration (DB)**: `cancel_booking` on a confirmed priced rental writes `fee_cents`; a hold and a pending request withdraw at fee 0; both apply cores add the fee only when `p_enforce_limits` and accumulate it; the BEFORE trigger snapshots `cancel_policy` from the offering on create and carries it on reschedule; the AFTER trigger zeroes the old row; `resolve_booking_token` returns the snapshot and fee; the 0081 backfills (window → one tier; live bookings get the snapshot).
- **Unit**: `cancelPolicySchema` (sort, dedupe, caps); `moneyInfoLines` with fee (live vs settled, balance math); `formatCancelPolicy` (all four segment kinds); `changeLines` (refund vs due vs nothing); `refundBooking` with a cap across two ledger rows (fake provider: first row fully refunded → `refunded`, second partially → stays `paid`); `cancelBookingAdmin` three modes (fee + refund amount per mode); messages parity (`messages.test.ts`).
- **Browser QA** (scripted Playwright, fake provider, after the build): set a two-tier policy, book + pay, cancel from inside the 50% tier (preview shows fee and refund; mail lines match; ledger row partially refunded), reschedule from inside the tier to a cheaper slot (change fee on the new row; excess refunded), admin cancel per policy / all / none.

## Deploy

Migration 0081 + app in one window (drops `cancel_window_min`, which the old build selects; changes the return type of `resolve_booking_token`). Next free migration after this slice: 0082. No new env.

## Out of scope (named so nobody builds them here)

Extending or shrinking a booking from the manage page (S7 overtime covers after-session) · collecting the fee shortfall or a reschedule difference online (S7 collect link; S3 records "outstanding" and "due at the venue") · fees on admin moves, refunds on admin moves that lower the price (S7 settlement) · workspace-level policy or copy-from-space · a "no self-service inside this tier" mode · re-consent to terms on a price change (H3 deferred) · Overview / daily list of outstanding fees (S4).
