# H3 — Prices & Terms (no Stripe)

**Date:** 2026-08-24 · **Status:** approved · **Branch:** feat/h3-prices
**Roadmap:** slice H3 of `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`
**Depends on:** H2 (merged, PR #55) · **Migrations:** 0057 (generated) + 0058 (custom) — H4 shifts to 0059

Structured pricing, deposit policy, cancellation window, and terms acceptance
on rental offerings, displayed end-to-end. No money moves: collection is
"pay at the venue". This makes demos sellable to the H0 interviewees; H4
plugs Stripe Connect into the deposit policy defined here.

## Rulings (settled in brainstorming)

1. **Currency is org-level.** One `orgs.currency` (default `PLN`), whitelist
   PLN / EUR / USD / GBP / CZK, edited in Settings. Matches H4's
   one-Stripe-account-per-org settlement. No per-offering currency.
2. **Rentals only.** `services.price_label` is untouched; no deposit/terms
   for appointments. H5 demotes appointments; parity can come later if ever
   needed.
3. **Cancel window is enforced,** not decorative: inside the window the
   client self-cancel is refused server-side and the manage page explains
   "contact the venue". Admin cancel is never gated. H4 reuses the same
   predicate for refund eligibility.
4. **Terms are per-offering** (`terms_text` on `rental_offerings`), edited in
   the offering dialog. No org-wide terms surface, no orgs RPC change for it.
5. **Approach A:** flat columns on `rental_offerings` + snapshot on
   `bookings`, computed inside the definer RPCs. No policies table, no
   unit-level pricing.

## Data model

### `rental_offerings` (0057; CHECKs in 0058)

| Column | Type | Meaning |
|---|---|---|
| `price_cents` | `integer NULL` | NULL = unpriced → every H3 surface collapses to today's rendering (no price line, no total, no deposit, no policy line). CHECK `>= 0`. |
| `pricing_mode` | `text NOT NULL DEFAULT 'per_unit'` | CHECK `('per_unit','flat')`. `per_unit` reads its unit from `range_mode`: per hour / per night / per day. `flat` = per booking. |
| `deposit_type` | `text NOT NULL DEFAULT 'none'` | CHECK `('none','fixed','percent','full')`. |
| `deposit_value` | `integer NULL` | Cents when `fixed`; whole percent 1–100 when `percent`; NULL for `none`/`full`. CHECKs pin the pairing. `percent`/`full` additionally require `price_cents NOT NULL`; `fixed` is legal on an unpriced offering ("free to book, 200 zł damage deposit at the venue"). |
| `cancel_window_min` | `integer NOT NULL DEFAULT 0` | 0 = cancellable until start. UI edits hours (hourly) / days (nights/days); stored minutes (`min_notice_min` idiom). CHECK `>= 0`. |
| `terms_text` | `text NULL` | House rules. Checkbox appears in public flows only when set. |

**`price_label` is dropped** from `rental_offerings` (replaced; pre-launch
data, nothing worth migrating — free text cannot be parsed into cents).
Seeds set structured prices instead. `services.price_label` stays.

### `orgs` (0057; CHECK + RPC in 0058)

`currency text NOT NULL DEFAULT 'PLN'`, CHECK against the whitelist.
Written ONLY via `update_org_scheduling` (the `timezone` pattern — orgs
stays select-only). Settings gains a currency select next to timezone.

### `bookings` snapshot (0057)

All nullable — appointments and pre-H3 rows stay NULL:

- `price_cents integer` — computed total at creation.
- `currency text` — org currency at creation.
- `deposit_cents integer` — computed deposit due at creation.
- `terms_accepted_at timestamptz` — stamped by the public create RPCs.

Snapshots are historical record: later offering-price or org-currency edits
never rewrite existing bookings.

## Computation (inside the definer RPCs, 0058)

Server-side only — price is never a client input (H2 ruling). Client-side
mirrors are display-only.

- **Total:** `flat` → `price_cents`. `per_unit` hours →
  `round(price_cents * duration_min / 60.0)`. Nights →
  `price_cents * (end_date - start_date)`. Days →
  `price_cents * (end_date - start_date + 1)` (R1 range semantics).
- **Deposit:** `none` → NULL. `fixed` → `least(deposit_value, total)` when
  priced, bare `deposit_value` when unpriced. `percent` →
  `round(total * deposit_value / 100.0)`. `full` → `total`.
- Unpriced offering → `price_cents`/`deposit_cents` NULL on the booking
  (except the bare fixed-deposit case above). `currency` is snapshotted
  whenever any money field is written, else left NULL.

### RPC changes (0058, CREATE OR REPLACE)

- `create_rental_booking`, `create_rental_booking_hours` (public): compute +
  snapshot; stamp `terms_accepted_at = now()` iff the offering has
  `terms_text` (the action refuses to call without the checkbox — the RPC
  stamps on-terms-present rather than trusting a client flag).
- `create_rental_booking_admin`, `create_rental_booking_hours_admin`:
  compute + snapshot; never stamp terms (walk-ins have no client acceptance).
- Reschedules **recompute** total + deposit from the offering at the new
  range (an admin move can change length). The recompute lives in the shared
  apply cores (`reschedule_rental_hours_apply` for hourly — covering both the
  tokenized client RPC `reschedule_rental_booking_hours` and the admin RPC —
  and the R2 apply helper behind `reschedule_rental_booking_admin` for
  nights/days). Client hourly reschedule is same-duration by construction,
  so its recompute is a no-op; recompute anyway for uniformity.
- `cancel_booking(p_token)`: for rental bookings, refuse when
  `now() > starts_at - make_interval(mins => cancel_window_min)` with a
  distinct error (`CANCEL_WINDOW_PASSED`); appointments and admin paths
  untouched.

## Surfaces

### Admin

- **Offering dialog** gains a "Pricing & policies" block: price input in
  major units (stored cents), per-unit/flat toggle labeled from `range_mode`
  ("per hour"/"per night"/"per day"); deposit type select + conditional
  value input (amount or %); cancellation window (hours for hourly, days for
  nights/days → minutes); terms textarea. Zod in `rentals/schema.ts` mirrors
  the CHECKs (incl. percent 1–100, percent/full-require-price).
- **Offerings list** shows the formatted price where `price_label` sat.
- **Settings**: currency select, saved through `update_org_scheduling`.

### Money formatting

`src/lib/money.ts`: `formatMoney(cents, currency)` via `Intl.NumberFormat`
(currency→locale map, PLN→pl-PL), trimming ".00";
`formatOfferingPrice(offering, currency)` → "120 zł / hour", "500 zł flat".
Consumed by admin, both public flows, manage page, and emails.

### Public flows (`rental-booking-flow.tsx`, `hourly-booking-flow.tsx`)

- Offering cards: formatted price replaces `priceLabel`.
- Confirm step summary block: computed total (client-side display mirror of
  the RPC formula), deposit line when due, "Pay at the venue" collection
  note, cancellation-policy sentence when a window is set ("Free
  cancellation until N hours/days before start"), and a required terms
  checkbox with the text in a collapsible when `terms_text` exists.
- Unpriced offering → the block collapses to today's rendering.
- Widget and booking page render rentals through these two components and
  inherit everything; the builder's services section is appointments-only
  and untouched.

### Manage page (client token link)

Shows total/deposit. Inside the cancel window the cancel button is replaced
with "The free-cancellation window has passed — contact the venue";
`CANCEL_WINDOW_PASSED` from the RPC maps to the same message (belt and
braces — the button check is advisory, the RPC is the gate).

### Emails

Client + provider **confirmation** emails gain total / deposit /
pay-at-the-venue lines and the cancellation-policy sentence. Cancel and
reschedule mails untouched (their hourly range-phrasing gap is already a
tracked H2 deferral).

## Testing

- **Unit:** money formatting; total/deposit mirror (fractional hours,
  percent rounding, fixed capped at total, unpriced, flat vs per-unit,
  nights vs days counting).
- **RPC integration:** snapshot written on all four create paths; SQL math
  matches the TS mirror; terms stamped iff offering has terms and never on
  admin paths; cancel refused inside window / allowed outside / at exactly
  the boundary; admin cancel ungated; reschedule recomputes; org currency
  change leaves old snapshots alone; CHECK violations (percent without
  price, deposit_value pairing) rejected.
- **Flow integration:** existing rental flow suites extended with the
  terms-checkbox requirement (submit refused without it when terms set).
- Test dates use `d(n)` offsets, not literals (H2 lesson).

## Out of scope / deferred

- Any payment collection, Stripe, holds, refunds — H4.
- Structured pricing for appointment services — unscheduled.
- Per-unit (per-room) pricing — conflicts with `unit_selection='auto'`; no
  validated demand.
- Multi-currency per org / currency conversion.
- Taxes, invoices, receipts — accountant questions pending (see memory).
- Discounts, coupons, seasonal pricing.

## Resolved roadmap open questions

- **Currency (open question #2):** PLN-first via org-level column +
  whitelist; multi-currency deferred. Deposit amounts inherit the org
  currency, satisfying the H4 settlement constraint by construction.
