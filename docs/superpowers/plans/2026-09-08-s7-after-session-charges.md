# S7 After-Session Charges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A studio adds labelled charges (overtime via a 30-minute-block helper, extra people, cleaning, damage, other) to a rental booking during or after the session; the booking's balance (`price + fee + charges − write-off − held`) is collected online from the manage page or a sent link, recorded as cash, or written off; a booking that has ended with nothing owed is settled.

**Architecture:** Migration 0082 adds `booking_charges` (own RLS), `bookings.written_off_cents/_note`, widens the ledger `kind` to `balance`, and adds the authoritative `booking_balance_cents(id)` SQL helper; three definer RPCs change (`apply_booking_payment` balance branch, `mark_booking_paid` for confirmed bookings, `write_off_booking` new, `rotate_booking_token` window widened). `startCheckout` and the pay route pay the deposit for a hold and the balance for anything else. A pure `settlement.ts` module (TS twin `balanceCents`, overtime helper) feeds `moneyInfoLines` (charge / write-off / balance lines), a new `BookingCharges` block in the booking detail, the manage page and two new mails. The token resolve is untouched: charges are read by booking id.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql `security definer` RPCs, RLS, migrations under `src/db/migrations`), Drizzle schema, zod 4, next-intl (en/uk/pl parity test), the S2 payments seam (`src/lib/payments/`, fake provider), Vitest (unit + `vitest.integration.config.ts`).

**Spec:** `docs/superpowers/specs/2026-09-08-s7-after-session-charges-design.md`

## Global Constraints

- Rentals only. Appointments get no charges UI and no balance (their `price_cents` is null → balance 0).
- **One balance formula**: `balance = coalesce(price,0) + fee + Σcharges − written_off − (paid − refunded)`. SQL `booking_balance_cents(id)` is authoritative for every write (checkout amount, mark-paid, write-off); TS `balanceCents(...)` renders; the lockstep test binds them. Negative = overpaid (display only, no automatic refund).
- Charges never mail on their own; the studio sends the balance link.
- Members cannot UPDATE `bookings` except the cancel transition (0079 `bookings_update_member` WITH CHECK) → write-off and mark-paid are RPCs; charges have their own table + RLS.
- `rotate_booking_token`: pending/hold → `starts_at > now()` (as today); confirmed → `ends_at > now() − 30 days`.
- `apply_booking_payment` on a `balance` row: confirmed → `paid_cents += amount`, return `'balance'`; anything else → `'slot_lost'` (refund path unchanged). Never changes status.
- Balance Checkout expiry: `now + 24 h`. Hold Checkout expiry unchanged.
- Migration `0082_after_session_charges.sql`, journal idx 82, snapshot `0082_snapshot.json` (copy of 0081's + the table, columns, CHECK). No dropped columns, no return-type changes → normal deploy order. Next free after this slice: 0083.
- Each task ships its own en **and** uk/pl strings (`src/i18n/messages.test.ts` refuses a partial locale). Forbidden words: en `rental`, `offering`, `skip`; uk `оренда`, `офер`, `пропустити`; pl `wynaj`, `pomiń`. No bare `%`/`−` in JSX under `features/**/components`.
- Unit: `npm run test -- <file>`; integration: `npm run test:integration -- <file>`; migrations `npm run db:migrate` (edited-after-apply → `npm run db:reset`); `npm run verify` = lint + typecheck + unit.
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5`.
- Branch: `feat/s7-after-charges` off `main` (created; the spec is its first commit).

---

## File map

| File | Responsibility |
|---|---|
| `src/features/payments/settlement.ts` (new) + `settlement.test.ts` | Pure: `Charge`, `CHARGE_KINDS`, `chargeInput`, `balanceCents`, `hourlyRateCents`, `overtimeCharge`. |
| `src/features/rentals/pricing.ts` + `pricing.test.ts` | `moneyInfoLines`: charge lines, write-off, balance wording, overpaid/settled. |
| `src/db/migrations/0082_after_session_charges.sql` (new), `meta/_journal.json`, `meta/0082_snapshot.json`, `src/db/schema/payments.ts`, `src/db/schema/scheduling.ts` | Table, columns, CHECK, helper, RPC deltas. |
| `src/features/payments/settlement.integration.test.ts` (new) | Lockstep + RPC/RLS deltas. |
| `src/features/payments/checkout.ts` + `checkout.integration.test.ts`, `src/app/booking/[token]/pay/route.ts` | Deposit-or-balance checkout. |
| `src/features/payments/apply.ts`, `confirm-effects.ts` (`sendBalanceReceived`), `src/features/scheduling/templates.ts` (`balanceDueEmail`, `balanceReceivedEmail`, lifecycle keys) | Webhook branch + mails. |
| `src/features/payments/queries.ts` (`getBookingSettlement`, `hasActivePaymentAccount`), `actions.ts` (`loadBookingSettlement`, `addBookingCharge`, `deleteBookingCharge`, `writeOffBooking`, `sendBalanceLink`) | Server reads/writes for the block. |
| `src/components/ui/decimal-input.tsx` (new, extracted from `pricing-rules-editor.tsx`) | Shared major-unit money input. |
| `src/features/payments/components/booking-charges.tsx` (new) | The charges + settlement block. |
| `src/features/scheduling/components/booking-detail-dialog.tsx`, `scheduling/queries.ts` (`writtenOffCents`) , `booking-actions.ts` (`markBookingPaid` copy) | Mount + one column. |
| `src/app/booking/[token]/page.tsx` | Settlement lines + "Pay now". |
| `messages/en.json`, `uk.json`, `pl.json` | Strings. |

---

### Task 1: The settlement module and the money lines (pure TypeScript)

**Files:**
- Create: `src/features/payments/settlement.ts`, `src/features/payments/settlement.test.ts`
- Modify: `src/features/rentals/pricing.ts` (`MoneyInfo`, `moneyInfoLines`), `src/features/rentals/pricing.test.ts`
- Modify: `messages/en.json`, `messages/uk.json`, `messages/pl.json` (`public.units`)

**Interfaces:**
- Produces: `type Charge = { id: string; kind: ChargeKind; label: string; qty: number; unitCents: number; cents: number; note: string | null }`, `CHARGE_KINDS`, `chargeInput` (Zod), `balanceCents(b)`, `hourlyRateCents(b)`, `overtimeCharge(minutes, rateCents)`; `MoneyInfo.charges?`, `.writtenOffCents?`, `.onlinePay?`.

- [ ] **Step 1: Strings.** In all three locale files under `public.units` add (keep the S3 keys):

en: `"chargeLine": "{label} — {amount}"`, `"chargeLineQty": "{label} × {qty} — {amount}"`, `"balanceDue": "{amount} due — pay online or at the venue"`, `"writtenOff": "Written off: {amount}"`, `"overpaid": "Overpaid: {amount}"`, `"settled": "Settled"`.
uk: `"{label} — {amount}"`, `"{label} × {qty} — {amount}"`, `"{amount} до сплати — онлайн або на місці"`, `"Списано: {amount}"`, `"Переплата: {amount}"`, `"Розраховано"`.
pl: `"{label} — {amount}"`, `"{label} × {qty} — {amount}"`, `"{amount} do zapłaty — online lub na miejscu"`, `"Umorzono: {amount}"`, `"Nadpłata: {amount}"`, `"Rozliczono"`.
(`chargeLine`/`chargeLineQty` are identical across locales — add both keys to `SAME_IN_EVERY_LOCALE` in `src/i18n/messages.test.ts` with the reason "label + amount only".)

- [ ] **Step 2: Failing tests** — `src/features/payments/settlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { balanceCents, chargeInput, hourlyRateCents, overtimeCharge } from "./settlement";

describe("balanceCents", () => {
  const base = { priceCents: 30000, feeCents: 0, chargesCents: 0, writtenOffCents: 0, paidCents: 0, refundedCents: 0 };
  it("total minus held, with fee, charges and write-off", () => {
    expect(balanceCents(base)).toBe(30000);
    expect(balanceCents({ ...base, paidCents: 9000 })).toBe(21000);
    expect(balanceCents({ ...base, feeCents: 5000, chargesCents: 10000, paidCents: 9000 })).toBe(36000);
    expect(balanceCents({ ...base, chargesCents: 10000, writtenOffCents: 40000 })).toBe(0);
    expect(balanceCents({ ...base, paidCents: 30000, refundedCents: 10000 })).toBe(10000);
  });
  it("negative means overpaid; unpriced counts as 0", () => {
    expect(balanceCents({ ...base, paidCents: 35000 })).toBe(-5000);
    expect(balanceCents({ ...base, priceCents: null, chargesCents: 2000 })).toBe(2000);
  });
});

describe("hourlyRateCents", () => {
  const h = (n: number) => new Date(Date.UTC(2027, 2, 10, 10 + n));
  it("rules-priced: the base line's unit", () => {
    expect(hourlyRateCents({ lines: [{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }], priceCents: 24000, startsAt: h(0), endsAt: h(2) })).toBe(12000);
  });
  it("flat per-unit: price / hours; null when unpriced or a null base unit", () => {
    expect(hourlyRateCents({ lines: null, priceCents: 30000, startsAt: h(0), endsAt: h(3) })).toBe(10000);
    expect(hourlyRateCents({ lines: null, priceCents: null, startsAt: h(0), endsAt: h(3) })).toBeNull();
    expect(hourlyRateCents({ lines: [{ kind: "base", qty: 2, unitCents: null, cents: 24000 }], priceCents: 24000, startsAt: h(0), endsAt: h(2) })).toBe(12000);
  });
});

describe("overtimeCharge", () => {
  it("rounds up to 30-minute blocks at half the hourly rate", () => {
    expect(overtimeCharge(0, 10000)).toEqual({ qty: 0, unitCents: 5000, cents: 0 });
    expect(overtimeCharge(10, 10000)).toEqual({ qty: 1, unitCents: 5000, cents: 5000 });
    expect(overtimeCharge(30, 10000)).toEqual({ qty: 1, unitCents: 5000, cents: 5000 });
    expect(overtimeCharge(31, 10000)).toEqual({ qty: 2, unitCents: 5000, cents: 10000 });
    expect(overtimeCharge(90, 10000)).toEqual({ qty: 3, unitCents: 5000, cents: 15000 });
    expect(overtimeCharge(30, 12345)).toEqual({ qty: 1, unitCents: 6173, cents: 6173 }); // half-up
  });
});

describe("chargeInput", () => {
  it("accepts a preset with a label, trims, computes nothing", () => {
    expect(chargeInput.parse({ bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "cleaning", label: " Cleaning ", qty: 1, unitCents: 15000 })).toEqual({
      bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "cleaning", label: "Cleaning", qty: 1, unitCents: 15000,
    });
  });
  it("rejects an unknown kind, an empty label, qty 0, negative or huge amounts", () => {
    const ok = { bookingId: "8d2f6b1e-3b3f-4d1c-9a6e-1a2b3c4d5e6f", kind: "other", label: "x", qty: 1, unitCents: 100 };
    expect(chargeInput.safeParse({ ...ok, kind: "tips" }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, label: "  " }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, qty: 0 }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, unitCents: -1 }).success).toBe(false);
    expect(chargeInput.safeParse({ ...ok, unitCents: 10_000_001 }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to see it fail** — `npm run test -- src/features/payments/settlement.test.ts` → cannot resolve `./settlement`.

- [ ] **Step 4: Create `src/features/payments/settlement.ts`** (pure — no `server-only`; the overtime helper runs in the browser):

```ts
// S7: after-session charges and settlement (spec 2026-09-08). Pure twins
// of the SQL: balanceCents mirrors public.booking_balance_cents (0082) and
// the lockstep test (settlement.integration.test.ts) fails if they drift.
import { z } from "zod";
import type { Line } from "@/features/rentals/pricing-rules";

export const CHARGE_KINDS = ["overtime", "people", "cleaning", "damage", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export type Charge = {
  id: string;
  kind: ChargeKind;
  label: string;
  qty: number;
  unitCents: number;
  cents: number;
  note: string | null;
};

export const chargeInput = z.object({
  bookingId: z.uuid(),
  kind: z.enum(CHARGE_KINDS),
  label: z.string().trim().min(1).max(80),
  qty: z.number().int().min(1).max(99),
  unitCents: z.number().int().min(0).max(10_000_000),
  note: z.string().trim().max(500).optional(),
});

/** balance = price + fee + charges − write-off − (paid − refunded). Negative = overpaid. */
export function balanceCents(b: {
  priceCents: number | null;
  feeCents: number;
  chargesCents: number;
  writtenOffCents: number;
  paidCents: number;
  refundedCents: number;
}): number {
  return (b.priceCents ?? 0) + b.feeCents + b.chargesCents - b.writtenOffCents - (b.paidCents - b.refundedCents);
}

/** The booking's own hourly rate for the overtime helper: a rules-priced
    booking's base line unit; else the flat total spread over its hours. */
export function hourlyRateCents(b: {
  lines: Line[] | null;
  priceCents: number | null;
  startsAt: Date;
  endsAt: Date;
}): number | null {
  const base = b.lines?.find((l) => l.kind === "base");
  if (base && base.unitCents !== null) return base.unitCents;
  if (b.priceCents === null) return null;
  const hours = (b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000;
  return hours > 0 ? Math.round(b.priceCents / hours) : null;
}

/** Overtime in started 30-minute blocks at half the hourly rate (half-up). */
export function overtimeCharge(minutes: number, rateCents: number): { qty: number; unitCents: number; cents: number } {
  const qty = Math.max(0, Math.ceil(minutes / 30));
  const unitCents = Math.round(rateCents / 2);
  return { qty, unitCents, cents: qty * unitCents };
}
```

- [ ] **Step 5: `moneyInfoLines`.** In `src/features/rentals/pricing.ts`, `MoneyInfo` gains:

```ts
  /** S7: after-session charges on the row, the write-off, and whether the
      org can take the balance online (wording of the balance line). */
  charges?: { label: string; qty: number; cents: number }[];
  writtenOffCents?: number;
  onlinePay?: boolean;
```

and the body becomes (replace from `const fee = i.feeCents ?? 0;` to the end of the paid/balance block):

```ts
  const fee = i.feeCents ?? 0;
  const charges = i.charges ?? [];
  const chargesTotal = charges.reduce((s, c) => s + c.cents, 0);
  const writtenOff = i.writtenOffCents ?? 0;
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (fee > 0 && i.currency) {
    lines.push(t(i.settled ? "cancellationFee" : "changeFee", { amount: formatMoney(fee, i.currency) }));
  }
  if (i.currency) {
    for (const c of charges) {
      lines.push(
        c.qty > 1
          ? t("chargeLineQty", { label: c.label, qty: c.qty, amount: formatMoney(c.cents, i.currency) })
          : t("chargeLine", { label: c.label, amount: formatMoney(c.cents, i.currency) }),
      );
    }
  }
  const held = Math.max(0, paid - refunded);
  const due = (i.totalCents ?? 0) + fee + chargesTotal - writtenOff - held;
  if (i.currency && paid > 0) {
    lines.push(t("paid", { amount: formatMoney(paid, i.currency) }));
    if (!i.settled && i.totalCents !== null && due > 0) {
      lines.push(t(i.onlinePay ? "balanceDue" : "balanceAtVenue", { amount: formatMoney(due, i.currency) }));
    }
  } else if (!i.settled) {
    if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
    if (i.holding && i.depositCents !== null && i.currency) lines.push(t("payNow", { amount: formatMoney(i.depositCents, i.currency) }));
    else if (lines.length > 0) {
      if (chargesTotal > 0 && i.currency && due > 0) lines.push(t(i.onlinePay ? "balanceDue" : "balanceAtVenue", { amount: formatMoney(due, i.currency) }));
      else lines.push(t("payAtVenue"));
    }
  }
  if (writtenOff > 0 && i.currency) lines.push(t("writtenOff", { amount: formatMoney(writtenOff, i.currency) }));
```

(the refund and policy lines that follow stay as they are). `balanceAtVenue` keeps its S2 wording for orgs that cannot collect online.

- [ ] **Step 6: `pricing.test.ts`** — every existing expectation is unchanged (no `charges`/`onlinePay` → old wording). Append:

```ts
describe("moneyInfoLines — S7 charges", () => {
  it("charge lines after the fee; balance counts them; online wording", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: null, paidCents: 9000,
      charges: [{ label: "Overtime", qty: 2, cents: 10000 }, { label: "Cleaning", qty: 1, cents: 15000 }], onlinePay: true }, t)).toEqual([
      "Total: 300 zł", "Overtime × 2 — 100 zł", "Cleaning — 150 zł", "Paid: 90 zł", "460 zł due — pay online or at the venue",
    ]);
  });
  it("write-off drops the balance and prints; unpaid booking with charges shows the balance instead of pay-at-venue", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: null, currency: "PLN", cancelPolicy: null, paidCents: 30000,
      charges: [{ label: "Damage", qty: 1, cents: 20000 }], writtenOffCents: 20000 }, t)).toEqual([
      "Total: 300 zł", "Damage — 200 zł", "Paid: 300 zł", "Written off: 200 zł",
    ]);
    expect(moneyInfoLines({ totalCents: 30000, depositCents: null, currency: "PLN", cancelPolicy: null,
      charges: [{ label: "Cleaning", qty: 1, cents: 15000 }] }, t)).toEqual([
      "Total: 300 zł", "Cleaning — 150 zł", "450 zł due at the venue",
    ]);
  });
});
```

(copy the file's exact `formatMoney` spacing.)

- [ ] **Step 7: Run** `npm run test -- src/features/payments/settlement.test.ts src/features/rentals/pricing.test.ts src/i18n/messages.test.ts` → PASS.

- [ ] **Step 8: Commit** — `feat(payments): settlement module (balance twin, overtime helper, charge input) + charge/write-off money lines (S7)`.

---

### Task 2: Migration 0082 — charges table, write-off, ledger kind, balance helper, RPC deltas; the integration suite

**Files:**
- Create: `src/db/migrations/0082_after_session_charges.sql`, `meta/0082_snapshot.json`; modify `meta/_journal.json`
- Modify: `src/db/schema/payments.ts` (add `bookingCharges`), `src/db/schema/scheduling.ts` (two columns)
- Create: `src/features/payments/settlement.integration.test.ts`

**Interfaces:**
- Produces: table `booking_charges`; `bookings.written_off_cents`, `written_off_note`; `booking_payments.kind in ('deposit','balance')`; `booking_balance_cents(uuid) → int` (service_role, authenticated); `write_off_booking(uuid, text) → uuid` (authenticated); `mark_booking_paid` accepting confirmed bookings; `apply_booking_payment` returning `'balance'`; `rotate_booking_token` widened.

- [ ] **Step 1: The migration**

```sql
-- S7 — after-session charges and settlement (spec docs/superpowers/specs/2026-09-08-s7-after-session-charges-design.md).

-- ---------- charges: their own table, their own RLS (ruling 8).
create table public.booking_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('overtime','people','cleaning','damage','other')),
  label text not null check (char_length(label) between 1 and 80),
  qty integer not null default 1 check (qty > 0),
  unit_cents integer not null check (unit_cents >= 0),
  cents integer not null check (cents >= 0 and cents = qty * unit_cents),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index booking_charges_booking_id_idx on public.booking_charges (booking_id);
--> statement-breakpoint
alter table public.booking_charges enable row level security;
--> statement-breakpoint
create policy "booking_charges_select_member" on public.booking_charges
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "booking_charges_insert_member" on public.booking_charges
  for insert to authenticated
  with check (org_id in (select public.user_orgs())
    and exists (select 1 from public.bookings b where b.id = booking_id and b.org_id = booking_charges.org_id));
--> statement-breakpoint
create policy "booking_charges_delete_member" on public.booking_charges
  for delete to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
-- Grants convention: newer images drop default ACLs.
grant select, insert, delete on table public.booking_charges to authenticated;
--> statement-breakpoint
grant all on table public.booking_charges to service_role;
--> statement-breakpoint

-- ---------- write-off on the booking; written only by write_off_booking.
alter table public.bookings
  add column written_off_cents integer not null default 0,
  add column written_off_note text,
  add constraint bookings_written_off_ck check (written_off_cents >= 0);
--> statement-breakpoint

-- ---------- the ledger learns balance payments.
alter table public.booking_payments drop constraint booking_payments_kind_check;
--> statement-breakpoint
alter table public.booking_payments add constraint booking_payments_kind_check check (kind in ('deposit','balance'));
--> statement-breakpoint

-- ---------- the one balance formula (TS twin: balanceCents in
-- src/features/payments/settlement.ts, lockstep-tested).
create function public.booking_balance_cents(p_booking_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(b.price_cents, 0) + b.fee_cents
       + coalesce((select sum(c.cents) from public.booking_charges c where c.booking_id = b.id), 0)::int
       - b.written_off_cents - (b.paid_cents - b.refunded_cents)
  from public.bookings b where b.id = p_booking_id;
$$;
--> statement-breakpoint
revoke all on function public.booking_balance_cents(uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.booking_balance_cents(uuid) to authenticated, service_role;
--> statement-breakpoint

-- ---------- write_off_booking: the balance becomes 0 (ruling 3).
create function public.write_off_booking(p_booking_id uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_due int;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id into v_id from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs()) and b.status = 'confirmed'
    for update;
  if v_id is null then raise exception 'not found'; end if;
  v_due := public.booking_balance_cents(v_id);
  if v_due <= 0 then raise exception 'nothing_due'; end if;
  update public.bookings set written_off_cents = written_off_cents + v_due,
    written_off_note = nullif(left(coalesce(p_note, ''), 500), '')
    where id = v_id;
  return v_id;
end; $$;
--> statement-breakpoint
revoke all on function public.write_off_booking(uuid, text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.write_off_booking(uuid, text) to authenticated;
--> statement-breakpoint

-- ---------- mark_booking_paid (base: 0079): a hold as before; a confirmed
-- booking records its whole balance as a manual `balance` row (decision 4).
create or replace function public.mark_booking_paid(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b record; v_due int;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id, b.org_id, b.status, b.deposit_cents, b.currency into v_b
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs())
      and b.status in ('pending_payment', 'confirmed') for update;
  if v_b.id is null then raise exception 'not found'; end if;
  if v_b.status = 'pending_payment' then
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'deposit', 'manual', v_b.deposit_cents, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + v_b.deposit_cents where id = v_b.id;
  else
    v_due := public.booking_balance_cents(v_b.id);
    if v_due <= 0 then raise exception 'not found'; end if;
    insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
      values (v_b.org_id, v_b.id, 'balance', 'manual', v_due, coalesce(v_b.currency, 'PLN'), 'paid', now());
    update public.bookings set paid_cents = paid_cents + v_due where id = v_b.id;
  end if;
  return v_b.id;
end; $$;
--> statement-breakpoint

-- ---------- apply_booking_payment (base: 0079): a `balance` row credits a
-- confirmed booking and never changes status (ruling 10); on a dead booking
-- it is money for nothing → slot_lost → the caller refunds.
create function public.apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int)
… -- copy the 0079 body (lines 630–666) verbatim and insert, right after the
  -- `update public.booking_payments … set status = 'paid' …` statement and
  -- the `select b.status into v_status … for update;` line:
  if v_pay.kind = 'balance' then
    if v_status = 'confirmed' then
      update public.bookings set paid_cents = paid_cents + p_amount_cents where id = v_pay.booking_id;
      return 'balance';
    end if;
    return 'slot_lost';
  end if;
  -- (the deposit branches follow unchanged)
-- and add `bp.kind` to the first `select bp.id, bp.booking_id, bp.status … into v_pay` list.
-- Re-issue the revoke + service_role grant lines exactly as 0079.
--> statement-breakpoint

-- ---------- rotate_booking_token (base: 0079): a confirmed booking's link
-- can be reissued after the session (ruling 9), inside the 30-day window
-- resolve_booking_token already honours.
create or replace function public.rotate_booking_token(p_booking_id uuid, p_token_hash text)
… -- 0079 body (lines 508–540) verbatim, with the UPDATE's predicate
  --   and b.status in ('confirmed','pending','pending_payment')
  --   and b.starts_at > now()
  -- replaced by
  --   and ((b.status in ('pending','pending_payment') and b.starts_at > now())
  --     or (b.status = 'confirmed' and b.ends_at > now() - interval '30 days'))
--> statement-breakpoint

-- Rollback: drop function write_off_booking, booking_balance_cents; recreate
-- apply_booking_payment (drop + create), mark_booking_paid and
-- rotate_booking_token from 0079; delete booking_payments rows with kind =
-- 'balance' then restore the kind CHECK to ('deposit'); alter table bookings
-- drop column written_off_cents, drop column written_off_note; drop table
-- booking_charges.
```

The "…" blocks are instructions: paste the full 0079 bodies and apply only the marked edits; `apply_booking_payment` keeps its signature (`create or replace`). Read each pasted body end to end.

- [ ] **Step 2: Journal + snapshot + drizzle.** Journal idx 82, tag `0082_after_session_charges`. Snapshot: copy 0081's, add `public.booking_charges` (columns above, the index, the three policies are NOT tracked in snapshots here — match how `booking_payments` appears in 0081's snapshot), `bookings.written_off_cents` (integer, not null, default 0) and `written_off_note` (text), bump `id`/`prevId`. Drizzle: in `src/db/schema/payments.ts` add

```ts
export const bookingCharges = pgTable(
  "booking_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    qty: integer("qty").default(1).notNull(),
    unitCents: integer("unit_cents").notNull(),
    cents: integer("cents").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_charges_booking_id_idx").on(t.bookingId)],
);
```

and in `scheduling.ts` after `feeCents`: `writtenOffCents: integer("written_off_cents").default(0).notNull(), writtenOffNote: text("written_off_note"),`.

- [ ] **Step 3: `npm run db:migrate`** → applied.

- [ ] **Step 4: The integration suite** — `src/features/payments/settlement.integration.test.ts`. Copy the seeding helpers from `src/features/payments/refund.integration.test.ts` (`signedInUser`, `newOrg`, `hoursFixture` with `price_cents 10000`, `activeAccount`, `createHours`, and a `pay(orgId, id, cents)` that inserts a `deposit` ledger row + `apply_booking_payment`). Set `process.env.PAYMENTS_PROVIDER = "fake"` / `PAYMENTS_FAKE_SECRET` before dynamic imports like `checkout.integration.test.ts`. Cases:

```ts
describe("booking_balance_cents ≡ balanceCents", () => {
  it("no charges / charges / write-off / refund / overpaid", async () => {
    const { client, orgId, handle } = await newOrg("lock");
    const { offeringId } = await hoursFixture(client, orgId, { deposit_type: "percent", deposit_value: 30 });
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // hold
    await pay(orgId, id, 3000);                                          // confirmed, paid 3000
    const expectBalance = async (expected: number) => {
      const { data } = await admin.rpc("booking_balance_cents", { p_booking_id: id });
      const row = await bookingRow(id);
      const { data: ch } = await admin.from("booking_charges").select("cents").eq("booking_id", id);
      const twin = balanceCents({
        priceCents: row.price_cents as number | null, feeCents: row.fee_cents as number,
        chargesCents: (ch ?? []).reduce((s, c) => s + (c.cents as number), 0),
        writtenOffCents: row.written_off_cents as number, paidCents: row.paid_cents as number, refundedCents: row.refunded_cents as number,
      });
      expect(data).toBe(expected); expect(twin).toBe(expected);
    };
    await expectBalance(7000);
    await client.from("booking_charges").insert({ org_id: orgId, booking_id: id, kind: "cleaning", label: "Cleaning", qty: 1, unit_cents: 15000, cents: 15000 });
    await expectBalance(22000);
    await admin.from("bookings").update({ written_off_cents: 2000 }).eq("id", id);
    await expectBalance(20000);
    await admin.from("bookings").update({ refunded_cents: 1000 }).eq("id", id);
    await expectBalance(21000);
    await admin.from("bookings").update({ written_off_cents: 0, refunded_cents: 0, paid_cents: 30000 }).eq("id", id);
    await expectBalance(-5000);
  });
});

describe("booking_charges RLS", () => {
  it("member inserts/reads/deletes; outsider sees nothing and cannot pin a charge to another org's booking", async () => {
    const a = await newOrg("rls_a"); const b = await newOrg("rls_b");
    const { offeringId } = await hoursFixture(a.client, a.orgId);
    const { id } = await createHours(a.handle, offeringId, startIn(100));
    const ins = await a.client.from("booking_charges").insert({ org_id: a.orgId, booking_id: id, kind: "other", label: "Props", qty: 2, unit_cents: 500, cents: 1000 }).select("id").single();
    expect(ins.error).toBeNull();
    expect((await b.client.from("booking_charges").select("id").eq("booking_id", id)).data).toEqual([]);
    const bad = await b.client.from("booking_charges").insert({ org_id: b.orgId, booking_id: id, kind: "other", label: "X", qty: 1, unit_cents: 100, cents: 100 });
    expect(bad.error).not.toBeNull(); // WITH CHECK: booking belongs to org a
    const del = await a.client.from("booking_charges").delete().eq("id", ins.data!.id).select("id");
    expect(del.data).toHaveLength(1);
  });
  it("cents must equal qty × unit_cents", async () => { /* insert cents 999 with qty 2 unit 500 → error */ });
});

describe("mark_booking_paid on a confirmed booking", () => {
  it("records a manual balance row and bumps paid_cents; refuses at balance 0", async () => {
    const { client, orgId, handle } = await newOrg("cash");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // confirmed, unpaid, balance 10000
    const { error } = await client.rpc("mark_booking_paid", { p_booking_id: id });
    expect(error).toBeNull();
    const row = await bookingRow(id); expect(row.paid_cents).toBe(10000);
    const { data: ledger } = await admin.from("booking_payments").select("kind, provider, amount_cents, status").eq("booking_id", id);
    expect(ledger).toEqual([{ kind: "balance", provider: "manual", amount_cents: 10000, status: "paid" }]);
    const again = await client.rpc("mark_booking_paid", { p_booking_id: id });
    expect(again.error?.message).toMatch(/not found/);
  });
});

describe("write_off_booking", () => {
  it("sets written_off_cents to the balance with a note; nothing_due when settled; org-gated", async () => { /* balance 10000 → write off "damaged lamp" → written_off_cents 10000, note stored; second call → nothing_due; another org's client → not found */ });
});

describe("apply_booking_payment with a balance row", () => {
  it("credits a confirmed booking without changing status; slot_lost on a cancelled one", async () => { /* insert booking_payments kind 'balance' pending with session id → apply → result 'balance', paid_cents +, status confirmed; cancel a booking (admin update status cancelled_by_provider) → new balance row → apply → 'slot_lost' */ });
});

describe("rotate_booking_token after the session", () => {
  it("accepts an ended confirmed booking, refuses one ended more than 30 days ago and a pending request that started", async () => { /* create confirmed booking; admin update starts_at/ends_at to yesterday → client.rpc rotate → ok; update ends_at to 40 days ago → not found */ });
});
```

Fill every `/* … */` with real code in the file (the shapes above name the exact assertions). `startIn` = the S3 helper (copy from `change-consequences.integration.test.ts`, with its midnight nudge).

- [ ] **Step 5: Run** `npm run test:integration -- src/features/payments/settlement.integration.test.ts src/features/payments/holds.integration.test.ts src/features/payments/refund.integration.test.ts src/features/payments/checkout.integration.test.ts src/features/rentals/change-consequences.integration.test.ts` → PASS (the S2 `checkout` suite still passes: holds unchanged).

- [ ] **Step 6: Commit** — `feat(db): 0082 after-session charges — booking_charges, write-off, balance ledger kind, booking_balance_cents, mark-paid/write-off/rotate deltas (S7)`.

---

### Task 3: Collection — deposit-or-balance checkout, the pay route, the webhook branch, two mails

**Files:**
- Modify: `src/features/payments/checkout.ts`, `checkout.integration.test.ts`, `src/app/booking/[token]/pay/route.ts`
- Modify: `src/features/payments/apply.ts`, `confirm-effects.ts` (`sendBalanceReceived`), `src/features/payments/queries.ts` (`getBookingSettlement`, `hasActivePaymentAccount`)
- Modify: `src/features/scheduling/templates.ts` (`balanceDueEmail`, `balanceReceivedEmail`, lifecycle keys)
- Modify: `messages/*.json` (`emails.balanceDue.*`, `emails.balanceReceived.*`)

**Interfaces:**
- Produces: `startCheckout` result `{ url } | { error: "nothing_due" | "expired" | "no_account" | "provider" }`; `getBookingSettlement(id): Promise<{ charges: Charge[]; writtenOffCents: number; writtenOffNote: string | null }>`; `hasActivePaymentAccount(orgId): Promise<boolean>`; `sendBalanceReceived(bookingId, deps?)`; `balanceDueEmail(t, { orgName, serviceName, whenLine, amount, payUrl, manageUrl, badgeUrl?, infoLines? })`, `balanceReceivedEmail(t, { orgName, serviceName, whenLine, badgeUrl?, infoLines? })`.

- [ ] **Step 1: `startCheckout`.** Rename the error `not_held` → `nothing_due` (type + both returns; update the two assertions in `checkout.integration.test.ts:168-169`). After the row read, replace the hold guard with:

```ts
  const isHold = row.status === "pending_payment";
  let kind: "deposit" | "balance";
  let amount: number;
  let expiresAt: number;
  if (isHold) {
    if (!row.hold_expires_at || !row.deposit_cents || !row.currency) return { error: "nothing_due" };
    const hold = new Date(row.hold_expires_at);
    if (hold.getTime() <= now.getTime()) return { error: "expired" };
    kind = "deposit"; amount = row.deposit_cents; expiresAt = checkoutExpiresAt(hold, now);
  } else if (row.status === "confirmed" && row.currency) {
    // S7: anything else pays its balance — the SQL helper is the amount's
    // only source (spec ruling 5).
    const { data: due, error: dueErr } = await db.rpc("booking_balance_cents", { p_booking_id: row.id });
    if (dueErr || typeof due !== "number" || due <= 0) return { error: "nothing_due" };
    kind = "balance"; amount = due; expiresAt = Math.floor(now.getTime() / 1000) + 24 * 3600;
  } else {
    return { error: "nothing_due" };
  }
```

then use `kind` in the ledger insert (`kind,`), `amount` in `amount_cents` and `createCheckout({ amountCents: amount, … })`, `expiresAt` as computed, and the product name gains ` — ${kind === "balance" ? "balance" : "deposit"}` … no: keep the product name as today for deposits and append ` · balance` for balance (product names are not translated today — leave English).

- [ ] **Step 2: Pay route.** Replace the hold-only guard with `if (b.status !== "pending_payment" && b.status !== "confirmed") return redirect(manage)`; drop the `holdExpiresAt` checks (startCheckout decides). Keep the rest.

- [ ] **Step 3: Checkout tests.** Add to `checkout.integration.test.ts`:

```ts
  it("a confirmed booking with a balance gets a balance session; balance 0 is nothing_due", async () => {
    const { orgId, id } = await held("balance");
    await admin.from("bookings").update({ status: "confirmed", hold_expires_at: null, paid_cents: 3000 }).eq("id", id);
    const res = await startCheckout(id, URLS, { db: admin, provider });
    expect("url" in res).toBe(true);
    const { data: rows } = await admin.from("booking_payments").select("kind, amount_cents, checkout_expires_at").eq("booking_id", id).eq("status", "pending");
    expect(rows).toHaveLength(1);
    expect(rows![0].kind).toBe("balance");
    expect(rows![0].amount_cents).toBe(/* price − 3000 as the fixture defines */ 7000);
    expect(new Date(rows![0].checkout_expires_at as string).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    await admin.from("bookings").update({ paid_cents: 10000 }).eq("id", id);
    await admin.from("booking_payments").update({ status: "expired" }).eq("booking_id", id);
    expect(await startCheckout(id, URLS, { db: admin, provider })).toEqual({ error: "nothing_due" });
  });
```

(read `held()` to learn the fixture's price and deposit; adjust 7000.)

- [ ] **Step 4: Webhook branch.** In `apply.ts` after the `confirmed` branch: `if (result === "balance") await sendBalanceReceived(ledger.booking_id, { db: deps.db, transport: deps.transport });`. In `confirm-effects.ts` add `sendBalanceReceived` — a copy of `sendPaymentReceived` that (a) also reads `written_off_cents` and the charges (`getBookingSettlement`), (b) builds the mail with `balanceReceivedEmail` and `infoLines: moneyInfoLines({ …money, charges, writtenOffCents, onlinePay: true }, client.tUnits)`, (c) key `bookingLifecycleKey(row.id, "balance-received")`, (d) no `notifyMembers` and no `kickCalendarSync` (nothing on the calendar changed). Extract the shared row read into a small `readBookingForMail(db, id)` if the copy exceeds ~30 lines.

- [ ] **Step 5: Queries.** In `src/features/payments/queries.ts`:

```ts
export async function getBookingSettlement(bookingId: string): Promise<{ charges: Charge[]; writtenOffCents: number; writtenOffNote: string | null }> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: b }] = await Promise.all([
    admin.from("booking_charges").select("id, kind, label, qty, unit_cents, cents, note").eq("booking_id", bookingId).order("created_at"),
    admin.from("bookings").select("written_off_cents, written_off_note").eq("id", bookingId).maybeSingle(),
  ]);
  return {
    charges: (rows ?? []).map((r) => ({ id: r.id, kind: r.kind as ChargeKind, label: r.label, qty: r.qty, unitCents: r.unit_cents, cents: r.cents, note: r.note })),
    writtenOffCents: b?.written_off_cents ?? 0,
    writtenOffNote: b?.written_off_note ?? null,
  };
}
export async function hasActivePaymentAccount(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("payment_accounts").select("org_id").eq("org_id", orgId).eq("status", "active").maybeSingle();
  return Boolean(data);
}
```

- [ ] **Step 6: Templates + strings.** In `templates.ts` add `"balance-due"` and `"balance-received"` (and the templated `` `balance-due:${cents}` `` — widen the `kind` union with a template literal type `` `balance-due:${number}` ``) to `bookingLifecycleKey`; add `balanceDueEmail` (clone of `paymentDueEmail` without `until`: lead `balanceDue.lead`, button `balanceDue.pay`, text `balanceDue.payText`, manage link `viewBooking`-style key — reuse `viewOrWithdraw` if that is what the manage-link line uses today) and `balanceReceivedEmail` (clone of `paymentReceivedEmail` with `balanceReceived.*`). Strings in en/uk/pl under `emails`:

en `balanceDue`: `subject` "Balance due — {service}, {when}", `lead` "Your session's charges and balance are below.", `pay` "Pay {amount}", `payText` "Pay {amount}: {url}"; `balanceReceived`: `subject` "Payment received — {service}, {when}", `lead` "Thank you — your balance is settled."
uk: "До сплати — {service}, {when}", "Нижче — нарахування за сесію та сума до сплати.", "Сплатити {amount}", "Сплатити {amount}: {url}"; "Платіж отримано — {service}, {when}", "Дякуємо — ваш рахунок розраховано."
pl: "Do zapłaty — {service}, {when}", "Poniżej opłaty za sesję i kwota do zapłaty.", "Zapłać {amount}", "Zapłać {amount}: {url}"; "Płatność otrzymana — {service}, {when}", "Dziękujemy — rachunek został rozliczony."

- [ ] **Step 7: Run** `npm run verify && npm run test:integration -- src/features/payments/checkout.integration.test.ts src/features/payments/settlement.integration.test.ts src/app/api/payments/webhook/route.integration.test.ts` → PASS (the webhook suite covers the deposit path; add one `balance` event case there if its harness makes it a five-line addition — otherwise leave it to the settlement suite's RPC case).

- [ ] **Step 8: Commit** — `feat(payments): deposit-or-balance checkout + pay route, balance webhook branch, balance-due / balance-received mails (S7)`.

---

### Task 4: Admin — the charges block, its actions, the dialog mount

**Files:**
- Create: `src/components/ui/decimal-input.tsx` (moved out of `pricing-rules-editor.tsx`, which imports it back)
- Create: `src/features/payments/components/booking-charges.tsx`
- Modify: `src/features/payments/actions.ts` (five actions), `src/features/scheduling/queries.ts` (`writtenOffCents`), `src/features/scheduling/components/booking-detail-dialog.tsx` (mount; replace `hold.paidBalance` for rentals), `src/features/scheduling/booking-actions.ts` (`markBookingPaid`: `notHeld` → `nothingDue` copy when the RPC refuses a confirmed booking; call `sendBalanceReceived` instead of `sendPaymentReceived` when the booking was already confirmed)
- Modify: `messages/*.json` (`bookings.charges.*`, `errors.nothingDue`)

**Interfaces:**
- Produces: `loadBookingSettlement({ bookingId }) → { ok, charges, writtenOffCents, writtenOffNote, balanceCents, hourlyRateCents, canCollect }`; `addBookingCharge(input)`, `deleteBookingCharge({ id })`, `writeOffBooking({ id, note })`, `sendBalanceLink({ id })` → `ActionResult`-shaped.
- Consumes: Task 1's helpers, Task 2's RPCs, Task 3's `getBookingSettlement`, `hasActivePaymentAccount`, `balanceDueEmail`.

- [ ] **Step 1: `DecimalInput`** — move the component verbatim from `pricing-rules-editor.tsx` to `src/components/ui/decimal-input.tsx` (named export), import it in the editor. `npm run test -- src/features/rentals` stays green.

- [ ] **Step 2: Actions** in `src/features/payments/actions.ts` (each `"use server"`, `requireOrg()`/RLS client, Zod input, `revalidatePath("/bookings")`):

```ts
export async function loadBookingSettlement(input: unknown) {
  const parsed = z.object({ bookingId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: (await getTranslations("errors"))("generic") };
  const org = await requireOrg();
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("id, org_id, status, price_cents, lines, starts_at, ends_at, client_email")
    .eq("id", parsed.data.bookingId).eq("org_id", org.id).maybeSingle();
  if (!b) return { ok: false as const, error: (await getTranslations("errors"))("generic") };
  const [settlement, { data: due }, canCollect] = await Promise.all([
    getBookingSettlement(b.id),
    supabase.rpc("booking_balance_cents", { p_booking_id: b.id }),
    hasActivePaymentAccount(org.id),
  ]);
  return {
    ok: true as const,
    ...settlement,
    balanceCents: typeof due === "number" ? due : 0,
    hourlyRateCents: hourlyRateCents({ lines: b.lines as Line[] | null, priceCents: b.price_cents, startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) }),
    canCollect: canCollect && Boolean(b.client_email),
  };
}
export async function addBookingCharge(input: unknown): Promise<ActionResult> { /* chargeInput.safeParse → insert { org_id, booking_id, kind, label, qty, unit_cents, cents: qty*unit_cents, note } with the RLS client → revalidate */ }
export async function deleteBookingCharge(input: unknown): Promise<ActionResult> { /* z.object({ id: z.uuid() }) → delete eq id eq org_id → revalidate */ }
export async function writeOffBooking(input: unknown): Promise<ActionResult> { /* z.object({ id: z.uuid(), note: z.string().trim().max(500).optional() }) → rpc write_off_booking; sentinel nothing_due → t("errors.nothingDue"); revalidate */ }
export async function sendBalanceLink(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  /* mirror resendManageLink (booking-actions.ts ~494): read the row (confirmed, org), require client_email, rpc booking_balance_cents > 0 else nothingDue, generateAccessToken + rpc rotate_booking_token, then the mail:
     balanceDueEmail(forClient.t, { orgName, serviceName, whenLine, amount: formatMoney(due, currency), payUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/pay?lang=${locale}`, manageUrl: buildBookingManageUrl(fresh.token), badgeUrl, infoLines: moneyInfoLines({ ...(await getBookingMoney(id)), charges, writtenOffCents, onlinePay: true }, forClient.tUnits) })
     idempotencyKey: bookingLifecycleKey(id, `balance-due:${due}`); same try/catch tail. */
}
```

Write every `/* … */` in full. `clientMailCopy` (`@/lib/booking/client-locale`) gives `forClient.t/tUnits/serviceName/whenLine` as `resendManageLink` uses it.

- [ ] **Step 3: The block** — `src/features/payments/components/booking-charges.tsx` (client component):

Props: `{ bookingId: string; currency: string | null; ended: boolean; paidCents: number; refundedCents: number }`. On mount (and after every mutation) `loadBookingSettlement`. Renders:
- `t("charges.title")`, the list: each row `label`, `× qty` when > 1, amount, a `RowRemove`-style ghost icon button (`deleteBookingCharge`).
- Add row: `<select className={nativeSelectClass}>` of `CHARGE_KINDS` (labels `charges.kind.*`; choosing a kind sets the label to that preset unless the label was edited), `<Input>` label, `<Input type="number" min=1 max=99>` qty, `<DecimalInput>` amount (major units → `unitCents`), `<Input>` note (optional), "Add" button → `addBookingCharge`.
- Overtime helper (only when `hourlyRateCents` is not null): `<Input type="number" min=0 step=5>` minutes + "Add overtime" → fills the add row with `kind: "overtime"`, label `charges.kind.overtime`, `qty`/`unitCents` from `overtimeCharge(minutes, rate)` — the studio can still edit before "Add".
- Settlement line: `balanceCents > 0` → `t("charges.balanceDue", { amount })`; `< 0` → `t("charges.overpaid", { amount })`; `=== 0 && ended` → `t("charges.settled")`; `=== 0 && !ended` → `t("charges.nothingDue")`. `writtenOffCents > 0` → `t("charges.writtenOff", { amount, note })`.
- Actions (when `balanceCents > 0`): **Mark balance paid** (confirm step → `markBookingPaid({ id })`), **Send balance link** (disabled when `!canCollect`, with `title` `charges.noEmailOrAccount`; → `sendBalanceLink`), **Write off** (reveals a note input + confirm → `writeOffBooking`). Toasts via `sonner`. No bare `%`/`−`.

- [ ] **Step 4: Mount.** In `booking-detail-dialog.tsx`: import and render `<BookingCharges …/>` in the body after the money lines for `booking.rentalUnitId !== null && booking.status === "confirmed"`; for those rows drop `paidLine`'s `hold.paidBalance` variant (the block owns the balance) — keep `hold.paid`. `scheduling/queries.ts`: add `written_off_cents` to `BOOKING_COLUMNS`, `writtenOffCents: number` to `AdminBooking` + mapper. `markBookingPaid` (`booking-actions.ts`): read the status before the RPC (one select) and afterwards call `sendBalanceReceived` when it was `confirmed`, `sendPaymentReceived` when it was a hold; map the `not found` sentinel to `errors.nothingDue` for a confirmed row.

- [ ] **Step 5: Strings** (en/uk/pl). `bookings.charges`: `title` "Charges", `kind.overtime` "Overtime", `kind.people` "Extra people", `kind.cleaning` "Cleaning", `kind.damage` "Damage", `kind.other` "Other", `label` "Label", `qty` "Qty", `amount` "Amount ({currency})", `note` "Note (internal)", `add` "Add charge", `remove` "Remove {label}", `minutes` "Overtime minutes", `addOvertime` "Add overtime", `balanceDue` "{amount} due", `overpaid` "Overpaid {amount}", `settled` "Settled", `nothingDue` "Nothing due", `writtenOff` "Written off {amount}", `writtenOffNote` "Written off {amount} — {note}", `markPaid` "Mark balance paid", `markPaidConfirm` "Confirm cash payment", `paid` "Balance marked as paid.", `sendLink` "Send balance link", `linkSent` "Balance link sent.", `noEmailOrAccount` "Needs a client email and an active payments account.", `writeOff` "Write off", `writeOffConfirm` "Confirm write-off", `writtenOffDone` "Balance written off.". `errors.nothingDue` "Nothing is due on this booking.". uk/pl equivalents (translate faithfully; forbidden words respected).

- [ ] **Step 6: Run** `npm run verify` + `npm run test -- src/i18n/messages.test.ts` → PASS.

- [ ] **Step 7: Commit** — `feat(admin): charges block on the booking detail — add/delete, overtime helper, mark balance paid, send balance link, write off (S7)`.

---

### Task 5: Public — the manage page's settlement lines and "Pay now"

**Files:**
- Modify: `src/app/booking/[token]/page.tsx`
- Modify: `messages/*.json` (`public.manage.payBalance`)

- [ ] **Step 1:** After the token resolve, `const [settlement, canCollect] = await Promise.all([getBookingSettlement(b.id), hasActivePaymentAccount(b.orgId)]);` (rentals only — skip for appointments). Pass `charges: settlement.charges.map(c => ({ label: c.label, qty: c.qty, cents: c.cents }))`, `writtenOffCents`, `onlinePay: canCollect` into `moneyInfoLines`. Compute `due = balanceCents({ priceCents: b.priceCents, feeCents: b.feeCents, chargesCents, writtenOffCents, paidCents: b.paidCents, refundedCents: b.refundedCents })`.
- [ ] **Step 2:** For `b.status === "confirmed"` and `due > 0 && canCollect`, render a brand button "Pay {amount} now" (`public.manage.payBalance`) linking to `/booking/${token}/pay?lang=${locale}` — in the future branch above `ManageBooking`, and in the `alreadyStarted` branch below its text. `?paid=1` on a confirmed booking already prints `paymentReceived` — keep.
- [ ] **Step 3:** Strings en "Pay {amount} now" / uk "Сплатити {amount}" / pl "Zapłać {amount}".
- [ ] **Step 4:** `npm run verify` → PASS. Commit — `feat(public): manage page shows charges, write-off and a Pay-now button for the balance (S7)`.

---

### Task 6: Full verify, browser QA, PR

- [ ] `npm run verify && npm run test:integration` → PASS.
- [ ] Browser QA (fake provider, :3001 worktree recipe from S3, owner `demo@rolloutos.local`): confirmed paid booking → open detail → add overtime via the helper (e.g. 40 min at 100 zł/h → 2 × 50 zł) + cleaning 150 zł → balance line; Send balance link → Mailpit mail with lines + pay link; open the pay link in the owner context → fake checkout → ledger `balance` row `paid`, `paid_cents` bumped, block shows "Settled" after the session (or "Nothing due" before); another booking → Mark balance paid (cash) → manual row; another → Write off with a note → "Written off"; manage page before the session shows "Pay X now"; delete a charge after payment → "Overpaid"; appointment detail shows no block.
- [ ] `graphify update .`; PR body: decisions 1–4, rulings 5–12, normal deploy (0082, next free 0083), deferred list (overpayment refund button, per-space overtime rule, partial cash, Overview balances → S4, invoices), QA table. `gh pr create --base main`.
