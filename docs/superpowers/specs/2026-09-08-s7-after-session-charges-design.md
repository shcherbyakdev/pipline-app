# S7 — After-session charges and settlement

Date: 2026-09-08. Roadmap slice S7 (`2026-09-07-studio-ops-roadmap-design.md`; order fixed by `2026-09-07-d1-decision.md` §5: S1 → S2 → S3 → **S7** → S4). Builds on S2 (`2026-09-07-s2-holds-collection-design.md`, 0079/0080) and S3 (`2026-09-07-s3-change-consequences-design.md`, 0081). Design approved in chat 2026-09-08 (four decisions below).

## Goal

After (or during) a session the studio adds **charges** to the same booking — overtime rounded to 30-minute blocks, extra people, cleaning, damage, anything else — and the booking's **balance** follows: total + fee + charges − write-off − what the client actually holds paid. The client can **pay the balance online** from the manage page or from a link the studio sends; the studio can **record a cash payment** of the balance or **write it off**. A booking is **settled** when it has ended and nothing is owed. 36 of the 40 studios surveyed publish after-session charges; none of the incumbents visibly collects them on the booking record.

## Decisions (2026-09-08, chosen from three options each)

1. **Charges are free-form labelled amounts with presets** (overtime · extra people · cleaning · damage · other) plus an **overtime helper**: minutes → 30-minute blocks × the booking's own hourly rate, editable before adding. No per-space overtime rule (studios' rules vary: "started hour", "30-min steps", ">10 min = +30"; the helper proposes, the studio decides). Rejected: a per-space rule in settings; free-form only.
2. **The balance is payable online any time it is > 0** when the org's account is active: the pay route pays the deposit for a hold and the balance for anything else; the manage page shows the button; the studio can also send a balance link. Rejected: pay only after the studio sends a link; only after the session.
3. **Write-off column, settled derived.** `written_off_cents` (+ note) drops the balance to 0; settled = ended and balance 0; no new status. Rejected: a manual `settled_at`; both.
4. **"Mark balance paid" records the whole balance as a manual ledger row** (extends the hold-only "Mark as paid"). Partial cash → write off the rest. Rejected: an amount field; no cash recording.

## Rulings

5. **Balance is the one formula, in SQL and TS:** `balance = price + fee + Σ charges − written_off − (paid − refunded)`. SQL `booking_balance_cents(booking_id)` is authoritative for every write (the pay route's amount, mark-paid, write-off); TS `balanceCents(...)` (lockstep-tested) renders it. An **overpaid** booking (balance < 0, e.g. a charge deleted after payment) prints "Overpaid X" in admin; no automatic refund (deferred — the studio refunds in Stripe).
6. **Charges never mail on their own.** A charge is a row the studio may still adjust; the client hears about it when the studio clicks "Send balance link" (or pays from the manage page, where the lines already show).
7. **The token resolve is unchanged.** Charges and the write-off are read server-side by booking id after the token resolves (no `resolve_booking_token` re-issue, no one-window deploy).
8. **Members' UPDATE policy on `bookings` admits only the cancel transition** (0079 `bookings_update_member` WITH CHECK `status = 'cancelled_by_provider'`), so write-off and mark-paid are definer RPCs, org-gated by `user_orgs()`, like `mark_booking_paid` today. Charges live in their own table with their own RLS.
9. **Balance link after the session:** `rotate_booking_token` widens from `starts_at > now()` to "confirmed and `ends_at > now() − 30 days`" (the window `resolve_booking_token` already honours), so the studio can (re)send a link to a client whose session is over. A rotated token still invalidates the previous one (the existing resend semantics).
10. **A balance payment never changes status.** `apply_booking_payment` on a `balance` row credits `paid_cents` and returns `balance`; on a dead booking (cancelled/expired/declined) it returns `slot_lost` and the money goes back exactly as a lost slot does today.
11. **Deposit-only Checkout expiry rules stay for holds**; a balance Checkout expires in 24 h (no hold to clamp to).
12. Appointments are untouched (no charges UI, no balance; `balance` for a service booking is 0 by construction: `price_cents` null).

## What exists and is reused

- S2: `booking_payments` ledger (`kind` CHECK `('deposit')`, `provider` `stripe|fake|manual`), `startCheckout` (`src/features/payments/checkout.ts`, hold-only), `GET /booking/[token]/pay` (hold-only), `apply_booking_payment` (0079), `mark_booking_paid` (0079, hold-only), `rotate_booking_token` (0079, future-only), `refundBooking` (S3-capped), `paymentDueEmail` / `paymentReceivedEmail` (`src/features/scheduling/templates.ts`), the `active` `payment_accounts` predicate (0079: `exists (select 1 from payment_accounts pa where pa.org_id = … and pa.status = 'active')`), `resendManageLink` (`src/features/scheduling/booking-actions.ts` ~494: reads the row, rotates the token, mails the new link).
- S3: `bookings.fee_cents`, `moneyInfoLines` with `feeCents`, `held = paid − refunded` balance math (`src/features/rentals/pricing.ts`), `getBookingMoney(id)`, the booking detail's fee / outstanding lines and `hold.paidBalance`.
- S1: `Line` kinds and `formatLine`; the hourly rate is on the booking (`lines[0]` base `unitCents` for a rules-priced booking, else `price_cents / hours` for a flat per-unit one).
- The booking detail dialog (`src/features/scheduling/components/booking-detail-dialog.tsx`, 430 lines) — S7 adds ONE mounted component, `BookingCharges`, not more lines in the dialog.
- 0028's column-scoped grant seam (`grant update (status, fee_cents) …`) — not used here (RPCs instead, ruling 8).

## Data model (migration `0082_after_session_charges`)

### `booking_charges` (new)

| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `org_id`, `booking_id` | uuid fk (orgs, bookings cascade) | |
| `kind` | text CHECK `('overtime','people','cleaning','damage','other')` | preset; also picks the default label |
| `label` | text not null, ≤ 80 | what the client reads |
| `qty` | int not null default 1, > 0 | blocks / people / pieces |
| `unit_cents` | int not null, ≥ 0 | |
| `cents` | int not null, ≥ 0, CHECK `cents = qty * unit_cents` | the line amount |
| `note` | text null ≤ 500 | internal (never mailed) |
| `created_by` | uuid null (auth.uid()) | |
| `created_at` | timestamptz default now() | |

Index `(booking_id)`. RLS: `select`/`delete` for `authenticated` USING `org_id in (select public.user_orgs())`; `insert` WITH CHECK `org_id in (select public.user_orgs()) and exists (select 1 from public.bookings b where b.id = booking_id and b.org_id = booking_charges.org_id)` (a charge can only be pinned to the org's own booking). No update policy (delete + re-add). Grants explicit: `select, insert, delete` to `authenticated`, `all` to `service_role`. Drizzle table in `src/db/schema/payments.ts`.

### `bookings`

- `written_off_cents int not null default 0` CHECK ≥ 0; `written_off_note text null`. Written only by `write_off_booking`.

### `booking_payments`

- `kind` CHECK → `('deposit','balance')`.

### SQL helper (granted to `service_role` for the lockstep test; reads tables → `stable`, `security definer`)

```sql
create function public.booking_balance_cents(p_booking_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(b.price_cents, 0) + b.fee_cents
       + coalesce((select sum(c.cents) from public.booking_charges c where c.booking_id = b.id), 0)
       - b.written_off_cents - (b.paid_cents - b.refunded_cents)
  from public.bookings b where b.id = p_booking_id;
$$;
```

### RPC deltas (`create or replace`, bodies from their latest migration with only these edits)

- **`apply_booking_payment`** (base 0079): after the ledger row flips to `paid`, read `bp.kind`. `kind = 'balance'`: if the booking's status is `confirmed` → `paid_cents = paid_cents + amount`, return `'balance'`; else return `'slot_lost'` (the caller refunds). `kind = 'deposit'`: the S2 body unchanged.
- **`mark_booking_paid`** (base 0079): a `pending_payment` row as today (deposit); a `confirmed` row with `booking_balance_cents(id) > 0` inserts `(kind 'balance', provider 'manual', amount = balance, status 'paid', paid_at now())` and adds it to `paid_cents`; anything else `raise exception 'not found'`. Returns the booking id as today.
- **`write_off_booking(p_booking_id uuid, p_note text)`** (new): org-gated (`user_orgs()`), `confirmed` only, `written_off_cents = written_off_cents + greatest(0, booking_balance_cents(id))`, `written_off_note = p_note`; raises `'nothing_due'` when the balance is ≤ 0. `authenticated`.
- **`rotate_booking_token`** (base 0079): the predicate `b.status in ('confirmed','pending','pending_payment') and b.starts_at > now()` becomes `(b.status in ('pending','pending_payment') and b.starts_at > now()) or (b.status = 'confirmed' and b.ends_at > now() - interval '30 days')` (ruling 9).

Rollback footer: drop `write_off_booking`, `booking_balance_cents`; recreate `apply_booking_payment`, `mark_booking_paid`, `rotate_booking_token` from 0079; `booking_payments` kind CHECK back to `('deposit')` (any `balance` rows deleted first); drop `bookings.written_off_cents`, `written_off_note`; drop table `booking_charges`.

## TypeScript

### Settlement module (`src/features/payments/settlement.ts`, new — pure, no `server-only`: the overtime helper runs in the browser)

- `Charge = { id; kind; label; qty; unitCents; cents; note }`, `CHARGE_KINDS`, `chargeInput` (Zod: kind, label ≤ 80 trimmed non-empty, qty int 1..99, unitCents int 0..10_000_000, note ≤ 500 optional).
- `balanceCents(b: { priceCents; feeCents; chargesCents; writtenOffCents; paidCents; refundedCents }): number` — the twin of `booking_balance_cents` (negative = overpaid).
- `hourlyRateCents(b: { lines; priceCents; startsAt; endsAt }): number | null` — `lines` base line `unitCents` when present, else `priceCents / hours`, else null.
- `overtimeCharge(minutes, rateCents): { qty: blocks, unitCents: rate / 2, cents }` — `blocks = ceil(minutes / 30)`, half-hour unit rounded.
- `getBookingSettlement(bookingId)` lives in `src/features/payments/queries.ts` (server): `{ charges: Charge[]; writtenOffCents: number; writtenOffNote: string | null }` from the admin client — used by the manage page, the mails, and the dialog's block (through the `loadBookingSettlement` action below).

### Money lines (`moneyInfoLines`, `src/features/rentals/pricing.ts`)

`MoneyInfo` gains `charges?: { label: string; qty: number; cents: number }[]`, `writtenOffCents?: number` and `onlinePay?: boolean`. Order: quote lines · total · fee · **charge lines** (`chargeLine`: "{label} × {qty} — {amount}", qty shown only when > 1) · paid · balance (`balanceDue` "{amount} due — pay online or at the venue" replaces `balanceAtVenue`'s wording when the org can collect online, else the old wording; the caller passes `onlinePay: boolean`) · **written off** (`writtenOff` "Written off: {amount}") · deposit lines · refund · policy. The balance is `balanceCents(...)`; when < 0 on an admin surface the detail prints `overpaid`. Settled rows (ended, balance 0) print `settled` ("Settled") in admin only.

### Collection

- **`startCheckout(bookingId, opts)`**: after the row read, decide `kind`: `pending_payment` with a live hold → `deposit` (today's path, unchanged); `confirmed` with `booking_balance_cents > 0` (one RPC call) → `balance`, amount = balance, `expiresAt = now + 24 h`, product name "{space} — {when} — balance"; else `{ error: "not_held" }` → renamed `"nothing_due"` (the route already redirects on any error). The ledger row carries the kind.
- **Pay route** (`src/app/booking/[token]/pay/route.ts`): the hold guard becomes "hold OR confirmed" (the balance check is `startCheckout`'s); `?paid=1` back on the manage page reads "Payment received" for both kinds.
- **Webhook side effects** (`src/features/payments/apply.ts`): result `balance` → `sendBalanceReceived(bookingId)` (mail with the settlement lines; no confirmation wording); `confirmed` / `slot_lost` as today.
- **`markBookingPaid` action** (`booking-actions.ts`): unchanged call, the RPC now accepts a confirmed booking; the toast copy for a balance: "Balance marked as paid".
- **`writeOffBooking({ id, note })` action** (new, `payments/actions.ts`): RPC + `revalidatePath`; sentinel `nothing_due` → error copy.
- **`sendBalanceLink({ id })` action** (new): reads the row (RLS), requires a positive balance, rotates the token (the widened RPC), mails `balanceDueEmail` with the settlement lines, the amount, the pay URL and the manage URL; toast on success. Same try/catch tail as `resendManageLink`.
- **`loadBookingSettlement({ bookingId })`** (new, org-checked through the RLS client): the block's data on open and after every mutation — charges are NOT added to the calendar queries (`BOOKING_COLUMNS` stays as is).
- **`addBookingCharge({ bookingId, kind, label, qty, unitCents, note })`** / **`deleteBookingCharge({ id })`** (new): RLS-client inserts/deletes on `booking_charges` (org from `currentOrg()`), `revalidatePath`. The overtime helper is client-side only (it fills the add row).

### Admin surfaces

- **`BookingCharges`** (`src/features/payments/components/booking-charges.tsx`, new; mounted in the detail dialog for rentals whose status is `confirmed`, live or ended): the charge list (label · qty · amount · delete), the add row (preset `<select>` sets the default label — presets from `payments.charges.kind.*`; label; qty; amount in major units via the existing `DecimalInput` idiom; note), the overtime helper (minutes input + "Add overtime" filling qty/unit from `overtimeCharge`), then the settlement block: `balanceDue` / `overpaid` / `settled` line and three actions — **Mark balance paid** (confirm), **Send balance link** (disabled without a client email or an active account), **Write off** (note input + confirm). The dialog's existing `hold.paidBalance` line is replaced by the block's balance line for rentals (appointments keep it).
- The dialog's footer (reschedule / cancel / resend) stays hidden for an ended booking exactly as today; the `BookingCharges` block renders in the dialog body for every `confirmed` rental (live or ended) and carries its own actions, so an ended session has a surface without reviving the lifecycle buttons.
- `scheduling/queries.ts`: `AdminBooking` gains `writtenOffCents` (one column on `BOOKING_COLUMNS`); charges come from `loadBookingSettlement` on open.
- `/payments` ledger listing shows the `balance` kind ("Balance") next to "Deposit".

### Public surfaces and mail

- Manage page (`src/app/booking/[token]/page.tsx`): after the token resolve, `getBookingSettlement(b.id)` feeds the money lines; for a `confirmed` booking with balance > 0 and an active account, a "Pay {amount} now" button to the pay route (any time, ruling 2), including after the session (the `alreadyStarted` branch keeps its text and gains the button).
- **`balanceDueEmail`** (new template): subject "Balance due — {service}, {when}", lead "Your session's charges and balance are below.", the lines, "Pay {amount}" button + text URL, manage link. **`balanceReceivedEmail`** (new): "Payment received — {service}, {when}", lead "Thank you — your balance is settled." + lines. Both `bookingLifecycleKey(id, "balance-due")` / `"balance-received"` (the due key includes the balance amount so a second send after new charges is a new mail: `balance-due:{cents}`).
- i18n (en · uk · pl): `public.units.chargeLine`, `balanceDue`, `writtenOff`, `overpaid`, `settled`; `bookings.charges.*` (title, kinds, add, overtime, minutes, addOvertime, delete, markBalancePaid, balancePaid, sendLink, linkSent, writeOff, writeOffNote, writtenOff, nothingDue, noEmail, noAccount); emails `balanceDue.*`, `balanceReceived.*`; `/payments` ledger kind labels.

## Tests

- **Lockstep (integration):** `booking_balance_cents` ≡ `balanceCents` over: no charges; charges; write-off; refunded money; overpaid (negative).
- **Integration (DB):** `booking_charges` RLS (member insert/select/delete; outsider sees nothing, insert refused; `booking_id` of another org refused); `mark_booking_paid` on a confirmed booking records a `balance` manual row and bumps `paid_cents`, refuses at balance 0; `write_off_booking` sets the column and `nothing_due`; `apply_booking_payment` with a `balance` row → `balance` + `paid_cents`; on a cancelled booking → `slot_lost`; `rotate_booking_token` accepts an ended confirmed booking and refuses one ended > 30 days ago; `startCheckout` for a confirmed booking creates a `balance` row with the balance amount and a 24 h expiry, and returns `nothing_due` at balance 0 (fake provider).
- **Unit:** `chargeInput`, `overtimeCharge` (0/10/30/31/90 minutes; odd rates), `hourlyRateCents` (rules-priced vs flat vs unpriced), `moneyInfoLines` with charges / write-off / overpaid / settled, `balanceCents` sign cases, messages parity.
- **Browser QA** (fake provider): add overtime via the helper + a cleaning charge; balance line; Send balance link → mail in Mailpit with lines + pay link; pay from the link → ledger `balance` row paid, `paid_cents` bumped, "Settled"; Mark balance paid (cash) on another booking; Write off with a note; manage page "Pay now" before the session; delete a charge after payment → "Overpaid".

## Deploy

Migration 0082 + app: no dropped columns, no return-type changes → the usual order (migrate, then deploy) is enough. Next free migration after this slice: 0083. No new env.

## Out of scope (named)

Per-space overtime rules · partial cash amounts · automatic refund of an overpayment (admin refunds in Stripe; a "Refund overpayment" button is a cheap follow-up) · listing balances due / settled on Overview (S4) · invoices and receipts · card-on-file / off-session charging (P24/BLIK cannot; cards could later) · charges on appointments · editing a charge in place (delete + re-add).
