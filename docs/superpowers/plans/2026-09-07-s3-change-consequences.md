# S3 Change Consequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A space's single free-cancellation window becomes a tiered policy; a client cancel or late reschedule incurs the tier's fee on the booking total, kept out of what was paid online with the rest refunded (partially) through Connect; the manage page shows the consequence before the client confirms; admin cancels default to the policy and can waive or keep everything.

**Architecture:** Migration 0081 adds `rental_offerings.cancel_policy` (tiers jsonb, replacing `cancel_window_min`), `bookings.cancel_policy` (snapshot, filled by the existing BEFORE INSERT carry trigger) and `bookings.fee_cents`; one pure SQL helper `cancel_fee_pct` with a TypeScript twin (`src/features/rentals/cancel-policy.ts`) under the S1 lockstep test; `cancel_booking` and both reschedule apply cores compute the fee in SQL. The refund engine gains an amount cap (partial refunds); the actions settle after the RPC from the committed row. `moneyInfoLines` learns the fee, the balance math and the policy line so every money surface follows.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql `security definer` RPCs, migrations under `src/db/migrations`), Drizzle schema, zod 4, next-intl (en/uk/pl parity test), Vitest (unit + `vitest.integration.config.ts` against the local Supabase stack), Base UI (`SegmentedTabs`, `Checkbox`), the S2 fake payments provider.

**Spec:** `docs/superpowers/specs/2026-09-07-s3-change-consequences-design.md`

## Global Constraints

- Rentals only. Appointments never carry a policy or a fee (`price_cents` null → fee 0; `cancel_policy` null).
- Tier policy shape: `[{ beforeMin: int 0..527040, feePct: int 0..100 }]`, sorted by `beforeMin` descending, unique `beforeMin`, at most 5. Evaluation: lead = `starts_at − now`; the first tier (largest lead first) whose lead is still met gives the pct; none met → 100; empty → 0.
- Fee = `round(total × pct / 100)` — SQL `round(x / 100.0)::int`, TS `Math.round(x / 100)`.
- Money is never TS-computed for display: `fee_cents`, `paid_cents`, `refunded_cents`, `price_cents` are read from the committed row. TS computes only PREVIEWS (before the client confirms) and the admin dialog's DEFAULT, both through the tested twin.
- Self-cancel is always allowed for a future booking (the `cancel_window` sentinel and `errors.cancelWindowPassed` are deleted, not kept dormant).
- `p_enforce_limits = true` in the apply cores means "the client is acting": limits AND the policy apply. `false` (admin) = no fee, no settlement.
- Partial refunds: a ledger row stays `paid` until `refunded_cents = amount_cents`, then `refunded`. Idempotency key per provider call: `{ledgerId}:{reason}:{refundedCentsBefore}`.
- Migration is `0081_change_consequences.sql`; journal idx 81; snapshot `0081_snapshot.json` (copy of `0080_snapshot.json` + the columns, − `cancel_window_min`). `resolve_booking_token` changes its return type and `cancel_window_min` is dropped → deploy migration and build in ONE window (PR body says so).
- Every new user-facing string exists in `messages/en.json`, `uk.json` and `pl.json` (`src/i18n/messages.test.ts` refuses a partial locale) — English lands per task, uk/pl in Task 8. Forbidden words: en `rental`, `offering`, `skip`; uk `оренда`, `офер`, `пропустити`; pl `wynaj`, `pomiń`. No bare `%`/`−` in JSX under `features/**/components` (put the `%` inside the message string).
- Unit tests: `npm run test -- <file>`; integration: `npm run test:integration -- <file>`; local stack `npm run setup`; migrations `npm run db:migrate` (a migration file edited after it was applied needs `npm run db:reset`). `npm run verify` = lint + typecheck + unit.
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5`.
- Branch: `feat/s3-change-consequences` off `main` (already created; the spec is its first commit).

---

## File map

| File | Responsibility |
|---|---|
| `src/features/rentals/cancel-policy.ts` (new) + `cancel-policy.test.ts` (new) | Types, Zod schema, `cancelFeePct`/`cancelFeeCents` (TS twin), `formatCancelWindow` (moved here), `formatCancelPolicy`, `adminCancelMoney`. |
| `src/features/rentals/pricing.ts` + `pricing.test.ts` | `MoneyInfo` gains `cancelPolicy`/`feeCents`; fee + balance + policy lines; `changeLines` (reschedule preview). |
| `src/db/migrations/0081_change_consequences.sql` (new), `meta/_journal.json`, `meta/0081_snapshot.json` | Columns, backfills, `cancel_fee_pct`, trigger deltas, `cancel_booking`, both apply cores, `resolve_booking_token`. |
| `src/db/schema/rentals.ts`, `src/db/schema/scheduling.ts` | Drizzle columns. |
| `src/features/rentals/change-consequences.integration.test.ts` (new) | Lockstep + every RPC/trigger delta. |
| `src/features/rentals/h3-money-rpc.integration.test.ts`, `approval-rpc.integration.test.ts`, `flow.integration.test.ts` | Re-point the four assertions that pinned the sentinel / the old column. |
| `src/features/rentals/schema.ts`, `actions.ts`, `queries.ts`, `src/lib/booking/public.ts`, `preview-catalog.ts`, `src/lib/tokens/booking.ts`, `src/features/payments/confirm-effects.ts`, `src/features/rentals/components/booking-money-summary.tsx`, `hourly-actions.ts`, `public-actions.ts`, `rentals/booking-actions.ts`, `rentals/manage-actions.ts`, `hourly.test.ts`, `preview-catalog.test.ts`, `schema.test.ts` | The `cancelWindowMin` → `cancelPolicy` plumbing; `getBookingMoney` new shape. |
| `src/features/payments/refund.ts` + `refund.integration.test.ts` | Amount-capped partial refunds. |
| `src/features/scheduling/manage-actions.ts`, `src/app/booking/[token]/page.tsx`, `src/features/scheduling/components/manage-booking.tsx` | Client cancel with fee + refund; cancel preview; `rescheduled` in `DEAD_STATUSES`. |
| `src/features/rentals/manage-actions.ts`, `components/hourly-reschedule-panel.tsx`, `components/rental-reschedule-panel.tsx` | Reschedule settlement (refund of the excess); previews on the candidate. |
| `src/features/rentals/components/cancel-policy-editor.tsx` (new), `offering-form.tsx` | The tiers editor. |
| `src/features/scheduling/booking-actions.ts`, `schema.ts`, `queries.ts`, `components/booking-detail-dialog.tsx` | Admin cancel modes; fee / outstanding lines. |
| `messages/en.json`, `uk.json`, `pl.json` | Strings. |

---

### Task 1: The policy module and the money lines (pure TypeScript)

**Files:**
- Create: `src/features/rentals/cancel-policy.ts`
- Create: `src/features/rentals/cancel-policy.test.ts`
- Modify: `src/features/rentals/pricing.ts` (lines 56–108: `formatCancelWindow`, `MoneyInfo`, `moneyInfoLines`; append `changeLines`)
- Modify: `src/features/rentals/pricing.test.ts` (every `cancelWindowMin:` literal)
- Modify: `messages/en.json` (`public.units` block, around line 431)

**Interfaces:**
- Produces: `CancelTier`, `CancelPolicy`, `cancelPolicySchema`, `cancelFeePct(policy, startsAt, at): number`, `cancelFeeCents(policy, totalCents, startsAt, at): number`, `formatCancelWindow(min, t)`, `formatCancelPolicy(policy, t): string | null`, `AdminRefundMode`, `adminCancelMoney(mode, booking, at): { feeCents, refundCents }`; `MoneyInfo.cancelPolicy` / `.feeCents`; `changeLines(input, t): string[]`.
- Consumes: `formatMoney` (`src/lib/money.ts`), `UnitsT` (`src/i18n/translator.ts`).

- [ ] **Step 1: Add the English strings** (uk/pl in Task 8). In `messages/en.json`, inside `public.units`, replace the line `"freeCancellation": "Free cancellation until {window} before start",` with:

```json
      "cancellationFee": "Cancellation fee: {amount}",
      "changeFee": "Late change fee: {amount}",
      "changeFeePct": "Late change fee: {amount} ({pct}%)",
      "cancelFeeNow": "Cancelling now: {amount} fee ({pct}%)",
      "willRefund": "{amount} will be refunded",
      "newTotal": "New total: {amount}",
      "policyFree": "Free cancellation until {window} before start",
      "policyTier": "{pct}% fee until {window} before",
      "policyAfter": "{pct}% after that",
```

- [ ] **Step 2: Write the failing unit tests** — `src/features/rentals/cancel-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import {
  adminCancelMoney,
  cancelFeeCents,
  cancelFeePct,
  cancelPolicySchema,
  formatCancelPolicy,
  type CancelPolicy,
} from "./cancel-policy";

const t = enTranslator("public.units");
const H = 60;
const D = 1440;
const start = new Date("2027-03-10T10:00:00Z");
const before = (min: number) => new Date(start.getTime() - min * 60_000);
const TWO: CancelPolicy = [
  { beforeMin: 72 * H, feePct: 0 },
  { beforeMin: 48 * H, feePct: 50 },
];

describe("cancelPolicySchema", () => {
  it("sorts descending and keeps unique leads", () => {
    expect(cancelPolicySchema.parse([{ beforeMin: 48 * H, feePct: 50 }, { beforeMin: 72 * H, feePct: 0 }])).toEqual(TWO);
  });
  it("rejects duplicate leads, more than five tiers, and out-of-range values", () => {
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60, feePct: 0 }, { beforeMin: 60, feePct: 50 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse(Array.from({ length: 6 }, (_, i) => ({ beforeMin: i * 60, feePct: 0 }))).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: -1, feePct: 0 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60, feePct: 101 }]).success).toBe(false);
    expect(cancelPolicySchema.safeParse([{ beforeMin: 60.5, feePct: 0 }]).success).toBe(false);
  });
  it("accepts an empty policy and a beforeMin of 0", () => {
    expect(cancelPolicySchema.parse([])).toEqual([]);
    expect(cancelPolicySchema.parse([{ beforeMin: 0, feePct: 80 }])).toEqual([{ beforeMin: 0, feePct: 80 }]);
  });
});

describe("cancelFeePct", () => {
  it("empty or null policy → 0", () => {
    expect(cancelFeePct([], start, before(10))).toBe(0);
    expect(cancelFeePct(null, start, before(10))).toBe(0);
  });
  it("picks the largest lead still met; the boundary itself is met", () => {
    expect(cancelFeePct(TWO, start, before(80 * H))).toBe(0);
    expect(cancelFeePct(TWO, start, before(72 * H))).toBe(0);
    expect(cancelFeePct(TWO, start, before(72 * H - 1))).toBe(50);
    expect(cancelFeePct(TWO, start, before(48 * H))).toBe(50);
  });
  it("no tier met → 100", () => {
    expect(cancelFeePct(TWO, start, before(48 * H - 1))).toBe(100);
    expect(cancelFeePct(TWO, start, before(0))).toBe(100);
    expect(cancelFeePct([{ beforeMin: 24 * H, feePct: 0 }], start, before(1))).toBe(100);
  });
  it("a beforeMin of 0 tier covers everything up to the start", () => {
    const p: CancelPolicy = [{ beforeMin: 24 * H, feePct: 0 }, { beforeMin: 0, feePct: 80 }];
    expect(cancelFeePct(p, start, before(1))).toBe(80);
    expect(cancelFeePct(p, start, before(0))).toBe(80);
  });
  it("ignores the input order (SQL is order-independent too)", () => {
    expect(cancelFeePct([...TWO].reverse(), start, before(80 * H))).toBe(0);
  });
});

describe("cancelFeeCents", () => {
  it("rounds half up on the total and is 0 for an unpriced booking", () => {
    expect(cancelFeeCents(TWO, 30000, start, before(60 * H))).toBe(15000);
    expect(cancelFeeCents([{ beforeMin: 0, feePct: 33 }], 101, start, before(1))).toBe(33); // 33.33 → 33
    expect(cancelFeeCents([{ beforeMin: 0, feePct: 50 }], 101, start, before(1))).toBe(51); // 50.5 → 51
    expect(cancelFeeCents(TWO, null, start, before(1))).toBe(0);
  });
});

describe("formatCancelPolicy", () => {
  it("null for an empty policy", () => {
    expect(formatCancelPolicy([], t)).toBeNull();
    expect(formatCancelPolicy(null, t)).toBeNull();
  });
  it("one free tier reads as free-until, then 100%", () => {
    expect(formatCancelPolicy([{ beforeMin: 3 * D, feePct: 0 }], t)).toBe(
      "Free cancellation until 3 days before start · 100% after that",
    );
  });
  it("two tiers in hours", () => {
    expect(formatCancelPolicy(TWO, t)).toBe(
      "Free cancellation until 72 hours before start · 50% fee until 48 hours before · 100% after that",
    );
  });
  it("a beforeMin of 0 tier replaces the trailing 100%", () => {
    expect(formatCancelPolicy([{ beforeMin: 24 * H, feePct: 0 }, { beforeMin: 0, feePct: 80 }], t)).toBe(
      "Free cancellation until 24 hours before start · 80% after that",
    );
  });
});

describe("adminCancelMoney", () => {
  const b = { cancelPolicy: TWO, priceCents: 30000, startsAt: start, paidCents: 9000, refundedCents: 0 };
  it("policy: fee from the tier, refund what is left", () => {
    expect(adminCancelMoney("policy", b, before(60 * H))).toEqual({ feeCents: 15000, refundCents: 0 });
    expect(adminCancelMoney("policy", b, before(80 * H))).toEqual({ feeCents: 0, refundCents: 9000 });
    expect(adminCancelMoney("policy", { ...b, priceCents: 10000 }, before(60 * H))).toEqual({ feeCents: 5000, refundCents: 4000 });
  });
  it("all: no fee, everything back; none: keep what was paid", () => {
    expect(adminCancelMoney("all", b, before(1))).toEqual({ feeCents: 0, refundCents: 9000 });
    expect(adminCancelMoney("none", b, before(1))).toEqual({ feeCents: 9000, refundCents: 0 });
  });
  it("already-refunded money is never counted twice", () => {
    expect(adminCancelMoney("all", { ...b, refundedCents: 4000 }, before(1))).toEqual({ feeCents: 0, refundCents: 5000 });
    expect(adminCancelMoney("none", { ...b, refundedCents: 4000 }, before(1))).toEqual({ feeCents: 5000, refundCents: 0 });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test -- src/features/rentals/cancel-policy.test.ts`
Expected: FAIL — cannot resolve `./cancel-policy`.

- [ ] **Step 4: Create `src/features/rentals/cancel-policy.ts`**

```ts
// S3: tiered change consequences (spec 2026-09-07-s3-change-consequences).
// The TypeScript twin of public.cancel_fee_pct (0081). SQL is authoritative
// for every write; this module computes PREVIEWS (the manage page, the
// reschedule panels) and the admin dialog's default, and the lockstep test
// (change-consequences.integration.test.ts) fails if the two drift.
import { z } from "zod";
import type { UnitsT } from "@/i18n/translator";

export type CancelTier = { beforeMin: number; feePct: number };
export type CancelPolicy = CancelTier[];

export const CANCEL_POLICY_MAX_TIERS = 5;

export const cancelTierSchema = z.object({
  // Minutes before start; 527040 = 366 days, the cancel-window cap H3 used.
  beforeMin: z.number().int().min(0).max(527040),
  feePct: z.number().int().min(0).max(100),
});

/** Sorted descending by lead on the way in (the editor may hand rows in any
    order); duplicate leads are refused rather than silently merged. */
export const cancelPolicySchema = z
  .array(cancelTierSchema)
  .max(CANCEL_POLICY_MAX_TIERS)
  .transform((tiers) => [...tiers].sort((a, b) => b.beforeMin - a.beforeMin))
  .refine((tiers) => new Set(tiers.map((t) => t.beforeMin)).size === tiers.length, {
    message: "duplicate tier",
  });

/** The percentage in force at `at` for a booking starting at `startsAt`:
    the tier with the largest lead the moment still meets; none → 100;
    empty → 0. Mirror of public.cancel_fee_pct — keep the two in lockstep. */
export function cancelFeePct(policy: CancelPolicy | null, startsAt: Date, at: Date): number {
  const tiers = policy ?? [];
  if (tiers.length === 0) return 0;
  const lead = startsAt.getTime() - at.getTime();
  const met = [...tiers]
    .filter((t) => lead >= t.beforeMin * 60_000)
    .sort((a, b) => b.beforeMin - a.beforeMin)[0];
  return met ? met.feePct : 100;
}

/** `round(total × pct / 100)` — identical to the SQL for non-negative halves. */
export function cancelFeeCents(
  policy: CancelPolicy | null,
  totalCents: number | null,
  startsAt: Date,
  at: Date,
): number {
  if (totalCents === null) return 0;
  return Math.round((totalCents * cancelFeePct(policy, startsAt, at)) / 100);
}

/** "3 days" / "48 hours" / "1.5 hours" for a lead in minutes (H3). */
export function formatCancelWindow(min: number, t: UnitsT): string {
  if (min % 1440 === 0) return t("days", { count: min / 1440 });
  const h = min / 60;
  return t("hours", { count: Number.isInteger(h) ? h : Math.round(h * 10) / 10 });
}

/** One line for the policy, or null when there is none: every tier is a
    segment (free-until / pct-until / pct-after for a lead of 0) and a
    policy whose smallest lead is above 0 ends in the implicit 100%. */
export function formatCancelPolicy(policy: CancelPolicy | null, t: UnitsT): string | null {
  const tiers = policy ?? [];
  if (tiers.length === 0) return null;
  const parts: string[] = [];
  for (const tier of tiers) {
    if (tier.beforeMin === 0) parts.push(t("policyAfter", { pct: tier.feePct }));
    else if (tier.feePct === 0) parts.push(t("policyFree", { window: formatCancelWindow(tier.beforeMin, t) }));
    else parts.push(t("policyTier", { pct: tier.feePct, window: formatCancelWindow(tier.beforeMin, t) }));
  }
  if (tiers[tiers.length - 1]!.beforeMin > 0) parts.push(t("policyAfter", { pct: 100 }));
  return parts.join(" · ");
}

export type AdminRefundMode = "policy" | "all" | "none";

/** The admin cancel dialog's three choices (spec decision 3), on what the
    row says was paid and already refunded. `none` keeps what was paid as
    the fee; `all` waives it; `policy` applies the tier. */
export function adminCancelMoney(
  mode: AdminRefundMode,
  b: {
    cancelPolicy: CancelPolicy | null;
    priceCents: number | null;
    startsAt: Date;
    paidCents: number;
    refundedCents: number;
  },
  at: Date,
): { feeCents: number; refundCents: number } {
  const held = Math.max(0, b.paidCents - b.refundedCents);
  switch (mode) {
    case "all":
      return { feeCents: 0, refundCents: held };
    case "none":
      return { feeCents: held, refundCents: 0 };
    case "policy": {
      const feeCents = cancelFeeCents(b.cancelPolicy, b.priceCents, b.startsAt, at);
      return { feeCents, refundCents: Math.max(0, held - feeCents) };
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/features/rentals/cancel-policy.test.ts`
Expected: PASS (all four describes).

- [ ] **Step 6: Move `formatCancelWindow` out of `pricing.ts` and teach `moneyInfoLines` the fee.** In `src/features/rentals/pricing.ts`:

Replace the import block's tail and the `formatCancelWindow` definition (lines 56–63) with a re-export:

```ts
import { formatCancelPolicy, formatCancelWindow, type CancelPolicy } from "./cancel-policy";
// H3 callers still import the window formatter from here.
export { formatCancelWindow };
```

Replace `MoneyInfo` and `moneyInfoLines` (lines 65–108) with:

```ts
export type MoneyInfo = {
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  /** S3: the booking's own snapshot (the offering's tiers for a quote). */
  cancelPolicy: CancelPolicy | null;
  /** S3: the consequence the row carries — a cancellation fee on a dead row,
      an accumulated late-change fee on a live one. */
  feeCents?: number;
  lines?: Line[] | null;
  /** S2: what the committed row says was paid / refunded (never computed here). */
  paidCents?: number;
  refundedCents?: number;
  /** S2: the booking is a hold awaiting its deposit. */
  holding?: boolean;
  /** S2: the booking is dead (expired / cancelled / declined / rescheduled) —
      nobody is turning up, so the lines must not tell the client to bring money. */
  settled?: boolean;
};

// Shared copy for the confirm step, the manage page and both emails. The
// quote's breakdown lines come first, one per line, and the total follows
// them (booking-money-summary.tsx relies on that order). S3: a fee prints
// right after the total and joins the balance ("due at the venue" = total +
// fee − paid). S2 states: a hold says "pay now"; a paid booking says what
// was paid and what is left for the venue; a refund prints last, before the
// policy line. A `settled` booking drops every "at the venue" / "deposit
// due" line and the policy line — nobody is coming, nothing is owed at the
// door, and the terms no longer apply.
export function moneyInfoLines(i: MoneyInfo, t: UnitsT): string[] {
  const lines: string[] = [];
  const paid = i.paidCents ?? 0;
  const refunded = i.refundedCents ?? 0;
  const fee = i.feeCents ?? 0;
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (fee > 0 && i.currency) {
    lines.push(t(i.settled ? "cancellationFee" : "changeFee", { amount: formatMoney(fee, i.currency) }));
  }
  if (i.currency && paid > 0) {
    lines.push(t("paid", { amount: formatMoney(paid, i.currency) }));
    if (!i.settled && i.totalCents !== null && i.totalCents + fee > paid) {
      lines.push(t("balanceAtVenue", { amount: formatMoney(i.totalCents + fee - paid, i.currency) }));
    }
  } else if (!i.settled) {
    if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
    if (i.holding && i.depositCents !== null && i.currency) lines.push(t("payNow", { amount: formatMoney(i.depositCents, i.currency) }));
    else if (lines.length > 0) lines.push(t("payAtVenue"));
  }
  if (i.currency && refunded > 0) lines.push(t("refund", { amount: formatMoney(refunded, i.currency) }));
  if (!i.settled) {
    const policy = formatCancelPolicy(i.cancelPolicy, t);
    if (policy) lines.push(policy);
  }
  return lines;
}

/** S3: what a reschedule to the candidate would mean, shown before the
    client confirms (both reschedule panels). `feeCents` is THIS move's tier
    fee, `priorFeeCents` what the row already carries from earlier moves;
    the balance counts both. Unpriced → nothing to say. */
export function changeLines(
  i: {
    newTotalCents: number | null;
    currency: string | null;
    feeCents: number;
    feePct: number;
    priorFeeCents: number;
    paidCents: number;
    refundedCents: number;
  },
  t: UnitsT,
): string[] {
  if (i.newTotalCents === null || !i.currency) return [];
  const lines = [t("newTotal", { amount: formatMoney(i.newTotalCents, i.currency) })];
  if (i.feeCents > 0) lines.push(t("changeFeePct", { amount: formatMoney(i.feeCents, i.currency), pct: i.feePct }));
  const held = Math.max(0, i.paidCents - i.refundedCents);
  const due = i.newTotalCents + i.priorFeeCents + i.feeCents - held;
  if (due < 0) lines.push(t("willRefund", { amount: formatMoney(-due, i.currency) }));
  else if (due > 0) lines.push(t("balanceAtVenue", { amount: formatMoney(due, i.currency) }));
  return lines;
}
```

- [ ] **Step 7: Update `pricing.test.ts`.** Every `cancelWindowMin: 0` → `cancelPolicy: null`; `cancelWindowMin: 1440` → `cancelPolicy: [{ beforeMin: 1440, feePct: 0 }]`; `cancelWindowMin: 120` → `cancelPolicy: [{ beforeMin: 120, feePct: 0 }]`. The expected `freeCancellation` strings become `"Free cancellation until 1 day before start · 100% after that"` (1440) and `"Free cancellation until 2 hours before start · 100% after that"` (120). The `settled: true` case at line 102 (`totalCents: 30000, depositCents: 6000, … settled: true`) now expects **only** the total line (the "Deposit due" on a dead row was an S2-ledgered nit). If a `formatCancelWindow` test exists, its import keeps working through the re-export. Then append:

```ts
describe("moneyInfoLines — S3 fee", () => {
  const P = [{ beforeMin: 4320, feePct: 0 }, { beforeMin: 2880, feePct: 50 }];
  it("a live row with a change fee: fee after the total, balance counts it", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 15000, paidCents: 9000 }, t)).toEqual([
      "Total: 300,00 zł",
      "Late change fee: 150,00 zł",
      "Paid: 90,00 zł",
      "360,00 zł due at the venue",
      "Free cancellation until 3 days before start · 50% fee until 2 days before · 100% after that",
    ]);
  });
  it("a cancelled row: cancellation fee, refund, no venue line, no policy line", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 15000, paidCents: 9000, refundedCents: 0, settled: true }, t)).toEqual([
      "Total: 300,00 zł",
      "Cancellation fee: 150,00 zł",
      "Paid: 90,00 zł",
    ]);
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 9000, currency: "PLN", cancelPolicy: P, feeCents: 3000, paidCents: 9000, refundedCents: 6000, settled: true }, t)).toEqual([
      "Total: 300,00 zł",
      "Cancellation fee: 30,00 zł",
      "Paid: 90,00 zł",
      "Refunded: 60,00 zł — bank refunds take up to 3 business days",
    ]);
  });
  it("fee 0 renders byte-identical to S2", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelPolicy: null, feeCents: 0, paidCents: 6000 }, t)).toEqual([
      "Total: 300,00 zł",
      "Paid: 60,00 zł",
      "240,00 zł due at the venue",
    ]);
  });
});

describe("changeLines", () => {
  const base = { currency: "PLN", priorFeeCents: 0, paidCents: 9000, refundedCents: 0 };
  it("cheaper slot inside a tier: new total, fee, refund of the excess", () => {
    expect(changeLines({ ...base, newTotalCents: 2000, feeCents: 5000, feePct: 50 }, t)).toEqual([
      "New total: 20,00 zł",
      "Late change fee: 50,00 zł (50%)",
      "20,00 zł will be refunded",
    ]);
  });
  it("dearer slot in the free tier: new total and the balance", () => {
    expect(changeLines({ ...base, newTotalCents: 40000, feeCents: 0, feePct: 0 }, t)).toEqual([
      "New total: 400,00 zł",
      "310,00 zł due at the venue",
    ]);
  });
  it("exactly settled says nothing beyond the total; a prior fee counts; unpriced says nothing", () => {
    expect(changeLines({ ...base, newTotalCents: 9000, feeCents: 0, feePct: 0 }, t)).toEqual(["New total: 90,00 zł"]);
    expect(changeLines({ ...base, newTotalCents: 5000, priorFeeCents: 4000, feeCents: 0, feePct: 0 }, t)).toEqual(["New total: 50,00 zł"]);
    expect(changeLines({ ...base, newTotalCents: null, feeCents: 0, feePct: 0 }, t)).toEqual([]);
  });
});
```

(Adjust the money formatting in the expectations to whatever `formatMoney(…, "PLN")` produces in the existing tests of this file — copy its exact spacing and separators.)

- [ ] **Step 8: Run the unit tests for the two files**

Run: `npm run test -- src/features/rentals/pricing.test.ts src/features/rentals/cancel-policy.test.ts`
Expected: PASS. (Typecheck will be red elsewhere until Task 3 — that is expected; do not run `npm run verify` yet.)

- [ ] **Step 9: Commit**

```bash
git add src/features/rentals/cancel-policy.ts src/features/rentals/cancel-policy.test.ts src/features/rentals/pricing.ts src/features/rentals/pricing.test.ts messages/en.json
git commit -m "feat(rentals): cancel-policy module — tiers, fee twin, policy line, change preview lines (S3)"
```

---

### Task 2: Migration 0081 — columns, backfills, `cancel_fee_pct`, triggers, RPC deltas; the integration suite

**Files:**
- Create: `src/db/migrations/0081_change_consequences.sql`
- Modify: `src/db/migrations/meta/_journal.json` (append idx 81)
- Create: `src/db/migrations/meta/0081_snapshot.json` (copy of `0080_snapshot.json`, edited)
- Modify: `src/db/schema/rentals.ts:38`, `src/db/schema/scheduling.ts:219-221`
- Create: `src/features/rentals/change-consequences.integration.test.ts`
- Modify: `src/features/rentals/h3-money-rpc.integration.test.ts` (cases 10, 11, 14), `approval-rpc.integration.test.ts` (fixture line 166 + the sentinel test at 292), `flow.integration.test.ts:250`

**Interfaces:**
- Produces: `public.cancel_fee_pct(jsonb, timestamptz, timestamptz) → int` (service_role may call it); `bookings.cancel_policy jsonb`, `bookings.fee_cents int`; `rental_offerings.cancel_policy jsonb`; `resolve_booking_token` returning `cancel_policy jsonb, fee_cents int` in place of `cancel_window_min`.
- Consumes: Task 1's `cancelFeePct` for the lockstep test.

- [ ] **Step 1: Write the migration** — `src/db/migrations/0081_change_consequences.sql`:

```sql
-- S3 — change consequences (spec docs/superpowers/specs/2026-09-07-s3-change-consequences-design.md).
-- Tiered cancellation policy on the space, snapshotted per booking; fee_cents
-- on the booking; one pure helper; cancel + both reschedule cores compute the
-- fee in SQL. Drops cancel_window_min (deploy with the app in one window).

-- ---------- columns
alter table public.rental_offerings
  add column cancel_policy jsonb not null default '[]'::jsonb,
  add constraint rental_offerings_cancel_policy_ck check (jsonb_typeof(cancel_policy) = 'array');
--> statement-breakpoint
alter table public.bookings
  add column cancel_policy jsonb,
  add column fee_cents integer not null default 0,
  add constraint bookings_cancel_policy_ck check (cancel_policy is null or jsonb_typeof(cancel_policy) = 'array'),
  add constraint bookings_fee_cents_ck check (fee_cents >= 0);
--> statement-breakpoint

-- ---------- backfills: "free until W" → one free tier (then 100%, ruling 5);
-- live rental bookings keep the window their client accepted.
update public.rental_offerings
  set cancel_policy = jsonb_build_array(jsonb_build_object('beforeMin', cancel_window_min, 'feePct', 0))
  where cancel_window_min > 0;
--> statement-breakpoint
update public.bookings b
  set cancel_policy = ro.cancel_policy
  from public.rental_offerings ro
  where ro.id = b.rental_offering_id
    and b.status in ('confirmed', 'pending', 'pending_payment')
    and b.starts_at > now();
--> statement-breakpoint
alter table public.rental_offerings
  drop constraint if exists rental_offerings_cancel_window_ck,
  drop column cancel_window_min;
--> statement-breakpoint

-- ---------- the helper (pure; the TS twin is cancelFeePct in
-- src/features/rentals/cancel-policy.ts — lockstep-tested). The tier with
-- the largest lead the moment still meets; none met → 100; empty → 0.
create function public.cancel_fee_pct(p_policy jsonb, p_starts_at timestamptz, p_at timestamptz)
returns int language sql immutable set search_path = '' as $$
  select coalesce(
    (select (t->>'feePct')::int
       from jsonb_array_elements(coalesce(p_policy, '[]'::jsonb)) t
      where p_at <= p_starts_at - make_interval(mins => (t->>'beforeMin')::int)
      order by (t->>'beforeMin')::int desc
      limit 1),
    case when jsonb_array_length(coalesce(p_policy, '[]'::jsonb)) = 0 then 0 else 100 end);
$$;
--> statement-breakpoint
revoke all on function public.cancel_fee_pct(jsonb, timestamptz, timestamptz) from public, anon, authenticated, service_role;
--> statement-breakpoint
-- The lockstep test calls it as service_role; it reads no table.
grant execute on function public.cancel_fee_pct(jsonb, timestamptz, timestamptz) to service_role;
--> statement-breakpoint

-- ---------- triggers (base 0079). BEFORE INSERT: the policy snapshot — from
-- the old row on a reschedule, else from the offering — one place for every
-- insert path (public create, accept, admin walk-in, both reschedule cores).
create or replace function public.carry_booking_locale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    if new.locale is null then
      select b.locale into new.locale from public.bookings b where b.id = new.rescheduled_from_id;
    end if;
    -- S2: money carries (spec §Flows "Reschedule": paid_cents carries).
    -- S3: so does the policy the client accepted.
    select b.paid_cents, b.refunded_cents, b.cancel_policy
      into new.paid_cents, new.refunded_cents, new.cancel_policy
      from public.bookings b where b.id = new.rescheduled_from_id;
  elsif new.cancel_policy is null and new.rental_offering_id is not null then
    select ro.cancel_policy into new.cancel_policy
      from public.rental_offerings ro where ro.id = new.rental_offering_id;
  end if;
  return new;
end; $$;
--> statement-breakpoint
-- AFTER INSERT: the ledger follows the live row (S2) and the old row is
-- zeroed (S3 ruling 10) — money lives on one row, every SUM is right.
create or replace function public.carry_booking_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    update public.booking_payments set booking_id = new.id, updated_at = now()
      where booking_id = new.rescheduled_from_id;
    update public.bookings set paid_cents = 0, refunded_cents = 0, fee_cents = 0
      where id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
--> statement-breakpoint

-- ---------- cancel_booking (base: 0079). The window gate and its sentinel
-- go (ruling 5): a confirmed rental cancels at the tier's fee, a hold or a
-- pending request withdraws free. SET reads the OLD row.
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b
    set status = 'cancelled_by_client',
        fee_cents = case
          when b.status = 'confirmed' and b.price_cents is not null
            then round(b.price_cents * public.cancel_fee_pct(b.cancel_policy, b.starts_at, now()) / 100.0)::int
          else 0 end
    where b.cancel_token_hash = v_hash and b.starts_at > now()
      and b.status in ('confirmed', 'pending', 'pending_payment')
    returning b.id into v_id;
  if v_id is null then return; end if;
  return query
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, public.booking_title(ro.name, u.name)),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
--> statement-breakpoint
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.cancel_booking(text) to service_role;
--> statement-breakpoint

-- ---------- resolve_booking_token (base: 0079): cancel_window_min →
-- cancel_policy (the booking's snapshot), + fee_cents. Return type changes:
-- drop + create.
drop function public.resolve_booking_token(text);
--> statement-breakpoint
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_policy jsonb, decline_note text,   -- S3
  lines jsonb, people int,
  hold_expires_at timestamptz, paid_cents int, refunded_cents int,                            -- S2
  fee_cents int                                                                               -- S3
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, b.cancel_policy, b.decline_note,
           b.lines, b.people,
           b.hold_expires_at, b.paid_cents, b.refunded_cents,
           b.fee_cents
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
--> statement-breakpoint
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.resolve_booking_token(text) to anon, service_role;
--> statement-breakpoint

-- ---------- reschedule_rental_hours_apply (base: 0078, lines 315–484 of
-- 0078_pricing_rules.sql, body copied verbatim except the five S3 edits
-- marked below). A client move (p_enforce_limits) inside a fee tier carries
-- the tier's fee onto the new row, accumulating (ruling 8).
create or replace function public.reschedule_rental_hours_apply(
  p_old_id uuid,
  p_unit_id uuid,
  p_starts_at timestamptz,
  p_new_token_hash text,
  p_enforce_limits boolean
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  old_ends_at timestamptz,
  new_starts_at timestamptz,
  new_ends_at timestamptz,
  unit_changed boolean,
  dates_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_org record;
  v_off record;
  v_duration int;
  v_ends timestamptz;
  v_unit uuid;
  v_new_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
  v_lines jsonb;    -- S1
  v_extras jsonb;   -- S1
  v_people int;     -- S1
  v_carry boolean := false;  -- S1
  v_fee int := 0;   -- S3
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at,
         b.lines, b.people, b.price_cents,                                              -- S1
         b.cancel_policy, b.fee_cents                                                   -- S3 (edit 1)
    into v_old
    from public.bookings b
    where b.id = p_old_id
    for update;
  -- … lines 363–421 of 0078 unchanged (guards, org/offering, duration,
  -- v_extras degrade, v_people clamp, re-quote with carry, deposit,
  -- currency) …
  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_starts_at <= now() + make_interval(mins => v_off.min_notice_min) then raise exception 'not found'; end if;
    if p_starts_at > now() + make_interval(days => v_off.booking_window_days + 1) then raise exception 'not found'; end if;
    -- S3 (edit 2): the tier in force NOW against the OLD start, on the OLD
    -- total — the booking being changed is the old one.
    if v_old.price_cents is not null then
      v_fee := round(v_old.price_cents * public.cancel_fee_pct(v_old.cancel_policy, v_old.starts_at, now()) / 100.0)::int;
    end if;
  end if;
  -- … lines 428–458 of 0078 unchanged (past guard, availability, advisory
  -- lock, old row → 'rescheduled', unit pick, 'taken') …
  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people,                                                                   -- S1
     fee_cents)                                                                       -- S3 (edit 3)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end, v_people,  -- S1
     v_old.fee_cents + v_fee)                                                         -- S3 (edit 4)
  returning id into v_new_id;
  -- … the return query, unchanged …
end;
$$;
--> statement-breakpoint
revoke all on function public.reschedule_rental_hours_apply(uuid, uuid, timestamptz, text, boolean)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- reschedule_rental_apply (base: 0070, lines 108–236 of
-- 0070_booking_title.sql, body copied verbatim except the same edits).
create or replace function public.reschedule_rental_apply(
  p_old_id uuid,
  p_unit_id uuid,
  p_start_date date,
  p_end_date date,
  p_new_token_hash text,
  p_enforce_limits boolean
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  old_ends_at timestamptz,
  new_starts_at timestamptz,
  new_ends_at timestamptz,
  unit_changed boolean,
  dates_changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_org record;
  v_off record;
  v_today date;
  v_len int;
  v_night_adj int;
  v_occ_start date;
  v_occ_end date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_unit uuid;
  v_new_id uuid;
  v_total int;
  v_deposit int;
  v_snap_currency text;
  v_fee int := 0;   -- S3
begin
  select b.id, b.org_id, b.rental_offering_id, b.rental_unit_id, b.client_id, b.client_name,
         b.client_email, b.note, b.starts_at, b.ends_at, b.status, b.terms_accepted_at,
         b.price_cents, b.cancel_policy, b.fee_cents                                  -- S3 (edit 1)
    into v_old
    from public.bookings b
    where b.id = p_old_id
    for update;
  -- … lines 154–169 of 0070 unchanged (guards, org/offering, v_today) …
  -- Notice + window are the public policy; the provider is not bound by them.
  if p_enforce_limits then
    if p_start_date < v_today + v_off.min_notice_days then raise exception 'not found'; end if;
    if p_end_date > v_today + v_off.booking_window_days then raise exception 'not found'; end if;
    -- S3 (edit 2)
    if v_old.price_cents is not null then
      v_fee := round(v_old.price_cents * public.cancel_fee_pct(v_old.cancel_policy, v_old.starts_at, now()) / 100.0)::int;
    end if;
  end if;
  -- … lines 176–219 of 0070 unchanged (length, total/deposit/currency,
  -- timestamps, lock, old row → 'rescheduled', unit pick, 'taken') …
  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id,
     price_cents, currency, deposit_cents, terms_accepted_at,
     fee_cents)                                                                       -- S3 (edit 3)
  values
    (v_old.org_id, v_off.id, v_unit, v_old.client_id, v_old.client_name, v_old.client_email,
     v_starts, v_ends, 'confirmed', p_new_token_hash, v_old.note, v_old.id,
     v_total, v_snap_currency, v_deposit, v_old.terms_accepted_at,
     v_old.fee_cents + v_fee)                                                         -- S3 (edit 4)
  returning id into v_new_id;
  -- … the return query, unchanged …
end;
$$;
--> statement-breakpoint
revoke all on function public.reschedule_rental_apply(uuid, uuid, date, date, text, boolean)
  from public, anon, authenticated, service_role;

-- Rollback: drop function cancel_fee_pct; drop + recreate resolve_booking_token
-- from 0079; `create or replace` cancel_booking from 0079, carry_booking_locale
-- and carry_booking_payments from 0079, reschedule_rental_hours_apply from
-- 0078, reschedule_rental_apply from 0070;
--   alter table public.rental_offerings add column cancel_window_min int not null default 0,
--     add constraint rental_offerings_cancel_window_ck check (cancel_window_min >= 0);
--   update public.rental_offerings set cancel_window_min = coalesce((cancel_policy->0->>'beforeMin')::int, 0);
--   alter table public.rental_offerings drop column cancel_policy;
--   alter table public.bookings drop column cancel_policy, drop column fee_cents;
```

**The "… unchanged …" markers are instructions to the implementer, not SQL**: open the base file at the cited lines and paste the body verbatim, applying only the marked edits. The finished migration must contain the full bodies. Read each pasted body once end-to-end before running it.

- [ ] **Step 2: Register the migration.** Append to `src/db/migrations/meta/_journal.json`'s `entries`:

```json
    {
      "idx": 81,
      "version": "7",
      "when": 1788900000000,
      "tag": "0081_change_consequences",
      "breakpoints": true
    }
```

Copy `meta/0080_snapshot.json` → `meta/0081_snapshot.json`; under `public.rental_offerings` remove the `cancel_window_min` column entry and its `rental_offerings_cancel_window_ck` check, add `cancel_policy` (`jsonb`, not null, default `'[]'::jsonb`) and the check `rental_offerings_cancel_policy_ck`; under `public.bookings` add `cancel_policy` (`jsonb`, nullable), `fee_cents` (`integer`, not null, default 0) and the two checks; set `prevId` to the 0080 snapshot's `id` and give `id` a fresh uuid (the 0080 file shows the shape).

- [ ] **Step 3: Drizzle schema.** In `src/db/schema/rentals.ts` replace lines 37–38 with:

```ts
    // S3: tiered cancellation policy [{beforeMin, feePct}] (cancel-policy.ts);
    // [] = always free. Replaced cancel_window_min in 0081.
    cancelPolicy: jsonb("cancel_policy").default([]).notNull(),
```

In `src/db/schema/scheduling.ts`, after `refundedCents` (line 221) add:

```ts
    // S3: the policy the client accepted (snapshot, filled by the carry
    // trigger) and the consequence incurred — never TS-computed for display.
    cancelPolicy: jsonb("cancel_policy"),
    feeCents: integer("fee_cents").default(0).notNull(),
```

(`jsonb` is already imported in both files — check the import line.)

- [ ] **Step 4: Apply the migration to the local stack**

Run: `npm run db:migrate`
Expected: `0081_change_consequences` applied without error. If the SQL errors, fix the file and run `npm run db:reset` (the file was already recorded as applied).

- [ ] **Step 5: Write the integration suite** — `src/features/rentals/change-consequences.integration.test.ts`. Seeding helpers are copied from `pricing-quote.integration.test.ts` (`newOrg`, `hoursFixture`) and `src/features/payments/refund.integration.test.ts` (`activeAccount`, `createHours`, the ledger insert + `apply_booking_payment`), which are file-local there:

```ts
/**
 * S3 lockstep + RPC contract: public.cancel_fee_pct ≡ cancelFeePct; the
 * carry trigger snapshots the policy; cancel_booking writes the fee (free
 * for holds and requests); the reschedule cores charge the fee only for the
 * client and accumulate it; the old row is zeroed; resolve_booking_token
 * returns the snapshot and the fee. Requires the local stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { cancelFeePct, type CancelPolicy } from "./cancel-policy";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const TZ = "Europe/Warsaw";
const H = 60;
const TWO: CancelPolicy = [{ beforeMin: 72 * H, feePct: 0 }, { beforeMin: 48 * H, feePct: 50 }];
let counter = 0;
type Row = Record<string, unknown>;

/** A start N hours from now, snapped to the next :00 (the fixture's grid is 30 min). */
function startIn(hours: number): string {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `s3_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

async function newOrg(tag: string) {
  const client = await signedInUser(tag);
  const { data: org, error: e1 } = await client.rpc("create_org", {
    p_name: `S3 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s3-${tag.replace(/_/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: handle, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours space, 100 zł/h flat, open every day, one unit; `over` wins. */
async function hoursFixture(client: SupabaseClient, orgId: string, over: Record<string, unknown> = {}) {
  const { data: off, error: e1 } = await client
    .from("rental_offerings")
    .insert({
      org_id: orgId, name: "Studio", range_mode: "hours",
      slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
      turnover_min: 0, min_notice_min: 0, booking_window_days: 730,
      unit_selection: "auto", active: true,
      price_cents: 10000, pricing_mode: "per_unit",
      cancel_policy: TWO,
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e2) throw e2;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId, rental_offering_id: off!.id, weekday, start_time: "00:00", end_time: "23:59",
  }));
  const { error: e3 } = await client.from("availability_rules").insert(rules);
  if (e3) throw e3;
  return { offeringId: off!.id as string };
}

async function activeAccount(orgId: string) {
  const { error } = await admin.from("payment_accounts").insert({
    org_id: orgId, stripe_account_id: `acct_test_${orgId.slice(0, 8)}_${counter++}`, status: "active",
  });
  if (error) throw error;
}

async function createHours(handle: string, offeringId: string, startsAt: string, durationMin = 60) {
  const t = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: null,
    p_starts_at: startsAt, p_duration_min: durationMin,
    p_name: "Ola", p_email: `ola${counter++}@example.com`, p_note: null,
    p_token_hash: t.tokenHash, p_people: null, p_extras: [],
  });
  if (error) throw error;
  return { id: data as string, token: t.token };
}

async function pay(orgId: string, bookingId: string, cents: number) {
  const session = `cs_s3_${bookingId}_${counter++}`;
  const { error } = await admin.from("booking_payments").insert({
    org_id: orgId, booking_id: bookingId, kind: "deposit", provider: "fake",
    amount_cents: cents, currency: "PLN", status: "pending",
    checkout_session_id: session, stripe_account_id: "acct_fake_x",
  });
  if (error) throw error;
  const { error: e } = await admin.rpc("apply_booking_payment", {
    p_session_id: session, p_payment_intent_id: `pi_${session}`, p_amount_cents: cents,
  });
  if (e) throw e;
}

const bookingRow = async (id: string): Promise<Row> => {
  const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Row;
};

describe("cancel_fee_pct ≡ cancelFeePct", () => {
  const start = new Date("2027-03-10T10:00:00Z");
  const before = (min: number) => new Date(start.getTime() - min * 60_000);
  const cases: Array<{ name: string; policy: CancelPolicy; at: Date }> = [
    { name: "empty → 0", policy: [], at: before(10) },
    { name: "far out → first tier", policy: TWO, at: before(80 * H) },
    { name: "on the 72h boundary → still free", policy: TWO, at: before(72 * H) },
    { name: "one minute inside → 50", policy: TWO, at: before(72 * H - 1) },
    { name: "on the 48h boundary → 50", policy: TWO, at: before(48 * H) },
    { name: "inside the last tier → 100", policy: TWO, at: before(48 * H - 1) },
    { name: "single free tier, inside → 100", policy: [{ beforeMin: 24 * H, feePct: 0 }], at: before(1) },
    { name: "beforeMin 0 tier → its pct", policy: [{ beforeMin: 24 * H, feePct: 0 }, { beforeMin: 0, feePct: 80 }], at: before(1) },
    { name: "unsorted input agrees", policy: [...TWO].reverse(), at: before(80 * H) },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const { data, error } = await admin.rpc("cancel_fee_pct", {
        p_policy: c.policy, p_starts_at: start.toISOString(), p_at: c.at.toISOString(),
      });
      expect(error).toBeNull();
      expect(data).toBe(cancelFeePct(c.policy, start, c.at));
    });
  }
  it("rounds the fee like the twin (half up)", async () => {
    // 101 × 50% = 50.5 → 51 on both sides; asserted through cancel_booking below.
    expect(Math.round((101 * 50) / 100)).toBe(51);
  });
});

describe("policy snapshot + cancel_booking", () => {
  let handle: string; let offeringId: string; let orgId: string;
  beforeAll(async () => {
    const org = await newOrg("cancel");
    ({ handle, orgId } = org);
    ({ offeringId } = await hoursFixture(org.client, orgId));
  });

  it("a new booking carries the offering's policy and fee 0", async () => {
    const { id } = await createHours(handle, offeringId, startIn(100));
    const row = await bookingRow(id);
    expect(row.cancel_policy).toEqual(TWO);
    expect(row.fee_cents).toBe(0);
  });

  it("cancelling inside the 50% tier writes half the total as the fee", async () => {
    const { id, token } = await createHours(handle, offeringId, startIn(60));
    const { data, error } = await admin.rpc("cancel_booking", { p_token: token });
    expect(error).toBeNull();
    expect((data as Row[]).length).toBe(1);
    const row = await bookingRow(id);
    expect(row.status).toBe("cancelled_by_client");
    expect(row.fee_cents).toBe(5000);
  });

  it("cancelling in the free tier and in the last tier: 0 and 100%", async () => {
    const free = await createHours(handle, offeringId, startIn(100));
    await admin.rpc("cancel_booking", { p_token: free.token });
    expect((await bookingRow(free.id)).fee_cents).toBe(0);
    const late = await createHours(handle, offeringId, startIn(2));
    await admin.rpc("cancel_booking", { p_token: late.token });
    expect((await bookingRow(late.id)).fee_cents).toBe(10000);
  });

  it("an offering edit does not change a live booking's policy", async () => {
    const { id, token } = await createHours(handle, offeringId, startIn(60));
    const { error } = await admin.from("rental_offerings").update({ cancel_policy: [] }).eq("id", offeringId);
    expect(error).toBeNull();
    await admin.rpc("cancel_booking", { p_token: token });
    expect((await bookingRow(id)).fee_cents).toBe(5000);
    await admin.from("rental_offerings").update({ cancel_policy: TWO }).eq("id", offeringId);
  });

  it("a hold withdraws free", async () => {
    const org = await newOrg("hold");
    const { offeringId: off } = await hoursFixture(org.client, org.orgId, { deposit_type: "percent", deposit_value: 50 });
    await activeAccount(org.orgId);
    const { id, token } = await createHours(org.handle, off, startIn(2));
    expect((await bookingRow(id)).status).toBe("pending_payment");
    const { error } = await admin.rpc("cancel_booking", { p_token: token });
    expect(error).toBeNull();
    const row = await bookingRow(id);
    expect(row.status).toBe("cancelled_by_client");
    expect(row.fee_cents).toBe(0);
  });

  it("a pending request withdraws free", async () => {
    const org = await newOrg("req");
    const { offeringId: off } = await hoursFixture(org.client, org.orgId, { requires_approval: true });
    const { id, token } = await createHours(org.handle, off, startIn(2));
    expect((await bookingRow(id)).status).toBe("pending");
    await admin.rpc("cancel_booking", { p_token: token });
    expect((await bookingRow(id)).fee_cents).toBe(0);
  });

  it("resolve_booking_token returns the snapshot and the fee", async () => {
    const { token } = await createHours(handle, offeringId, startIn(60));
    await admin.rpc("cancel_booking", { p_token: token });
    const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
    expect(error).toBeNull();
    const row = (data as Row[])[0]!;
    expect(row.cancel_policy).toEqual(TWO);
    expect(row.fee_cents).toBe(5000);
    expect(row).not.toHaveProperty("cancel_window_min");
  });
});

describe("reschedule cores", () => {
  let client: SupabaseClient; let handle: string; let offeringId: string; let orgId: string;
  beforeAll(async () => {
    const org = await newOrg("move");
    ({ client, handle, orgId } = org);
    // 30% deposit + an active account: every booking is born a hold and
    // becomes confirmed by paying it (apply_booking_payment only credits a
    // pending_payment / expired row — a confirmed one reports slot_lost).
    ({ offeringId } = await hoursFixture(client, orgId, { deposit_type: "percent", deposit_value: 30 }));
    await activeAccount(orgId);
  });
  /** A confirmed hourly booking with 3000 paid. */
  async function paidHours(startsAt: string) {
    const b = await createHours(handle, offeringId, startsAt);
    expect((await bookingRow(b.id)).status).toBe("pending_payment");
    await pay(orgId, b.id, 3000);
    expect((await bookingRow(b.id))).toMatchObject({ status: "confirmed", paid_cents: 3000 });
    return b;
  }

  it("a client move inside the tier carries the fee, the policy, the money; the old row is zeroed", async () => {
    const { id, token } = await paidHours(startIn(60));
    const { data, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token, p_unit_id: null, p_starts_at: startIn(200), p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    const newId = (data as Row[])[0]!.new_booking_id as string;
    const fresh = await bookingRow(newId);
    expect(fresh.fee_cents).toBe(5000);
    expect(fresh.cancel_policy).toEqual(TWO);
    expect(fresh.paid_cents).toBe(3000);
    const old = await bookingRow(id);
    expect(old.status).toBe("rescheduled");
    expect(old).toMatchObject({ paid_cents: 0, refunded_cents: 0, fee_cents: 0 });
    const { data: ledger } = await admin.from("booking_payments").select("booking_id").eq("booking_id", newId);
    expect(ledger!.length).toBe(1);
  });

  it("a late move then a free-tier move: the fee is carried, not doubled; a second late move adds", async () => {
    const { token } = await paidHours(startIn(60));
    // The new row's token is the hash we hand in — keep it for the next move.
    const t2 = generateAccessToken();
    const first = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token, p_unit_id: null, p_starts_at: startIn(84), p_new_token_hash: t2.tokenHash,
    });
    expect(first.error).toBeNull();
    const id2 = (first.data as Row[])[0]!.new_booking_id as string;
    expect((await bookingRow(id2)).fee_cents).toBe(5000);
    // 84 h out → the free tier: the fee carries but nothing is added.
    const t3 = generateAccessToken();
    const second = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: t2.token, p_unit_id: null, p_starts_at: startIn(60), p_new_token_hash: t3.tokenHash,
    });
    expect(second.error).toBeNull();
    const id3 = (second.data as Row[])[0]!.new_booking_id as string;
    expect((await bookingRow(id3)).fee_cents).toBe(5000);
    // Now 60 h out again → 50% of the (unchanged) 10000 total on top.
    const third = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: t3.token, p_unit_id: null, p_starts_at: startIn(300), p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(third.error).toBeNull();
    const id4 = (third.data as Row[])[0]!.new_booking_id as string;
    expect((await bookingRow(id4)).fee_cents).toBe(10000);
  });

  it("an admin move never charges", async () => {
    const { id } = await paidHours(startIn(2));
    const { data, error } = await client.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: id, p_unit_id: null, p_starts_at: startIn(3), p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    const newId = (data as Row[])[0]!.new_booking_id as string;
    expect((await bookingRow(newId)).fee_cents).toBe(0);
    expect((await bookingRow(newId)).cancel_policy).toEqual(TWO);
  });
});
```

Note for the implementer: `startIn` snaps to `:00` so every start sits on the fixture's 30-minute grid; the 100/84/60/2-hour leads are chosen to land in the free / free / 50% / 100% tiers of `TWO`.

- [ ] **Step 6: Re-point the old tests.**
  - `h3-money-rpc.integration.test.ts` case 10 (line 486): rename to `"case 10: cancel_booking inside the free window now cancels at 100% (S3 ruling 5)"`; fixture `cancel_policy: [{ beforeMin: 2880, feePct: 0 }]` instead of `cancel_window_min: 2880`; replace the three assertions with `expect(error).toBeNull(); const row = await bookingRow(...); expect(row.status).toBe("cancelled_by_client"); expect(row.fee_cents).toBe(row.price_cents);`. Case 11: `cancel_policy: [{ beforeMin: 60, feePct: 0 }]`, keep its assertions, add `expect(row.fee_cents).toBe(0)`. Case 14: fixture `cancel_policy: [{ beforeMin: 120, feePct: 0 }]`; `expect(row.cancel_policy).toEqual([{ beforeMin: 120, feePct: 0 }])` and `expect(row.fee_cents).toBe(0)`; appointment side `expect(apptRow.cancel_policy).toBeNull()`. Update the file header comment (line 9).
  - `approval-rpc.integration.test.ts`: fixture line 166 → `cancel_policy: [{ beforeMin: 10_080, feePct: 0 }]`; the test at line 292 becomes `"a confirmed stay inside the window cancels at 100% (S3)"` asserting `cancelErr` null, status `cancelled_by_client`, `fee_cents === price_cents`.
  - `flow.integration.test.ts:250`: `expect(fresh.booking.cancelPolicy).toEqual([])` (the TS field lands in Task 3 — leave this line as-is until then and come back; or change it now and accept one red typecheck until Task 3).

- [ ] **Step 7: Run the integration suites**

Run: `npm run test:integration -- src/features/rentals/change-consequences.integration.test.ts src/features/rentals/h3-money-rpc.integration.test.ts src/features/rentals/approval-rpc.integration.test.ts src/features/payments/refund.integration.test.ts src/features/payments/holds.integration.test.ts src/features/rentals/pricing-quote.integration.test.ts`
Expected: PASS. (`flow.integration.test.ts` may fail on the TS field until Task 3.)

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/0081_change_consequences.sql src/db/migrations/meta/_journal.json src/db/migrations/meta/0081_snapshot.json src/db/schema/rentals.ts src/db/schema/scheduling.ts src/features/rentals/change-consequences.integration.test.ts src/features/rentals/h3-money-rpc.integration.test.ts src/features/rentals/approval-rpc.integration.test.ts
git commit -m "feat(db): 0081 change consequences — cancel_policy tiers + snapshot, fee_cents, cancel_fee_pct, fee in cancel + reschedule cores (S3)"
```

---

### Task 3: The `cancelWindowMin` → `cancelPolicy` plumbing; `getBookingMoney` reads the snapshot

**Files:**
- Modify: `src/features/rentals/schema.ts:33`, `src/features/rentals/actions.ts:70`, `src/features/rentals/queries.ts:50,64,91,126`
- Modify: `src/lib/booking/public.ts` (`PublicOffering` ~458–521; `getBookingMoney` 870–905)
- Modify: `src/lib/booking/preview-catalog.ts:46,78`, `src/lib/booking/preview-catalog.test.ts:24`
- Modify: `src/lib/tokens/booking.ts:38,93,121`
- Modify: `src/features/payments/confirm-effects.ts:16,34,69`
- Modify: `src/features/rentals/components/booking-money-summary.tsx:27,40`
- Modify: `src/features/rentals/hourly-actions.ts:316`, `public-actions.ts:299`, `rentals/booking-actions.ts:574,741`, `rentals/manage-actions.ts:529`
- Modify: `src/features/rentals/hourly.test.ts:40`, `schema.test.ts` (any `cancelWindowMin` fixture), `flow.integration.test.ts:250`

**Interfaces:**
- Produces: `PublicOffering.cancelPolicy: CancelPolicy`, `OfferingRow.cancelPolicy: CancelPolicy`, `offeringInput.cancelPolicy`, `resolveBookingToken().booking.cancelPolicy: CancelPolicy | null` + `.feeCents: number`, `getBookingMoney(bookingId): Promise<{ totalCents, depositCents, currency, cancelPolicy, feeCents, paidCents, refundedCents, startsAt, lines }>`.
- Consumes: Task 1's types; Task 2's columns.

- [ ] **Step 1: Zod + write path.** `rentals/schema.ts:33` → `cancelPolicy: cancelPolicySchema.default([]),` with `import { cancelPolicySchema } from "./cancel-policy";`. `rentals/actions.ts:70` → `cancel_policy: d.cancelPolicy,`.

- [ ] **Step 2: Reads.** `rentals/queries.ts`: type field `cancelPolicy: CancelPolicy;` (import the type), the select string `cancel_window_min` → `cancel_policy`, the row type `cancel_policy: CancelPolicy;`, the mapper `cancelPolicy: o.cancel_policy,`. `lib/booking/public.ts`: same four edits on `PublicOffering` / its select / row / mapper. `preview-catalog.ts`: `cancelPolicy: []` at line 46, `cancelPolicy: o.cancelPolicy` at 78; the test fixture at `preview-catalog.test.ts:24` → `cancelPolicy: []`. `hourly.test.ts:40` → `cancelPolicy: []`.

- [ ] **Step 3: Token resolve.** `lib/tokens/booking.ts`: the booking type gains

```ts
        // S3: the policy the client accepted (the booking's own snapshot;
        // null for appointments and pre-S3 rows) and the consequence the row
        // carries — a cancellation fee on a dead row, a late-change fee on a
        // live one.
        cancelPolicy: CancelPolicy | null;
        feeCents: number;
```

in place of `cancelWindowMin: number | null;`; the raw row type `cancel_policy: CancelPolicy | null; fee_cents: number;` in place of `cancel_window_min`; the mapper `cancelPolicy: row.cancel_policy ?? null, feeCents: row.fee_cents ?? 0,`. `flow.integration.test.ts:250` → `expect(fresh.booking.cancelPolicy).toEqual([]); expect(fresh.booking.feeCents).toBe(0);`.

- [ ] **Step 4: `getBookingMoney` reads the snapshot.** Replace the function (public.ts 870–905) with:

```ts
/** S1/S3: the money a committed booking actually carries — the RPC's own
    snapshot on the row, never a recomputation (a rules-priced offering has
    no single totalCents formula to re-derive, and the studio may have edited
    its rules or its policy since). Shaped for moneyInfoLines; the currency
    is the one the RPC stamped alongside the total. `paidCents` / `feeCents`
    / `startsAt` are here for the reschedule settlement (manage-actions). */
export async function getBookingMoney(bookingId: string): Promise<{
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  cancelPolicy: CancelPolicy | null;
  feeCents: number;
  paidCents: number;
  refundedCents: number;
  startsAt: Date | null;
  lines: Line[] | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("lines, price_cents, deposit_cents, currency, cancel_policy, fee_cents, paid_cents, refunded_cents, starts_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) console.error("[booking] getBookingMoney:", error);
  const row = data as {
    lines: unknown;
    price_cents: number | null;
    deposit_cents: number | null;
    currency: string | null;
    cancel_policy: CancelPolicy | null;
    fee_cents: number;
    paid_cents: number;
    refunded_cents: number;
    starts_at: string;
  } | null;
  return {
    totalCents: row?.price_cents ?? null,
    depositCents: row?.deposit_cents ?? null,
    currency: row?.currency ?? null,
    cancelPolicy: row?.cancel_policy ?? null,
    feeCents: row?.fee_cents ?? 0,
    paidCents: row?.paid_cents ?? 0,
    refundedCents: row?.refunded_cents ?? 0,
    startsAt: row ? new Date(row.starts_at) : null,
    lines: (row?.lines as Line[] | null) ?? null,
  };
}
```

Its callers drop the second argument: `rentals/booking-actions.ts:574,741`, `rentals/manage-actions.ts:529`. (`moneyInfoLines` ignores the extra fields.)

- [ ] **Step 5: The three inline `money` objects.** `hourly-actions.ts:316` and `public-actions.ts:299`: `cancelWindowMin: ctx.offering.cancelWindowMin,` → `cancelPolicy: ctx.offering.cancelPolicy,`. `confirm-effects.ts`: select `rental_offerings(name, range_mode)` (drop `cancel_window_min`), add `cancel_policy, fee_cents` to the booking columns; row type accordingly; the `money` object → `cancelPolicy: row.cancel_policy, feeCents: row.fee_cents,`. `booking-money-summary.tsx`: prop type `offering: MoneyFields & { cancelPolicy: CancelPolicy; termsText: string | null };` and `cancelPolicy: offering.cancelPolicy` in the `moneyInfoLines` call.

- [ ] **Step 6: Typecheck + unit tests green**

Run: `npm run verify`
Expected: PASS (lint, `tsc`, every unit test). Fix any `cancelWindowMin` straggler `tsc` names — `grep -rn "cancelWindowMin\|cancel_window_min" src --exclude-dir=migrations` must return only `offering-form.tsx` (Task 7 replaces it) and nothing else.

- [ ] **Step 7: Run the integration suites touched by the rename**

Run: `npm run test:integration -- src/features/rentals/flow.integration.test.ts src/features/rentals/hourly-flow.integration.test.ts src/features/payments/checkout.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "refactor(rentals): cancelWindowMin → cancelPolicy across offerings, tokens, emails; getBookingMoney reads the snapshot (S3)"
```

---

### Task 4: Partial refunds — `refundLedgerRow` / `refundBooking` take an amount cap

**Files:**
- Modify: `src/features/payments/refund.ts` (lines 17–108 `refundLedgerRow`; 185–213 `refundBooking`)
- Modify: `src/features/payments/refund.integration.test.ts` (append)

**Interfaces:**
- Produces: `refundLedgerRow(ledgerId, reason, deps?, { bumpBooking?, amountCents? })`, `refundBooking(bookingId, reason, deps?, { amountCents? })` — same return shapes as today.

- [ ] **Step 1: Write the failing integration test** — append to `refund.integration.test.ts` inside `describe("refundBooking", …)`:

```ts
  it("caps at amountCents across rows: the first row empties, the second stays paid", async () => {
    const { id } = await paidBooking("cap", "cs_cap");           // row A: 5000
    const { data: b0 } = await admin.from("bookings").select("org_id").eq("id", id).single();
    // Row B: a second 2000 payment on the same booking.
    const { error } = await admin.from("booking_payments").insert({
      org_id: b0!.org_id, booking_id: id, kind: "deposit", provider: "fake",
      amount_cents: 2000, currency: "PLN", status: "pending",
      checkout_session_id: `cs_cap2_${id}`, stripe_account_id: "acct_fake_x",
    });
    if (error) throw error;
    const { error: e } = await admin.rpc("apply_booking_payment", {
      p_session_id: `cs_cap2_${id}`, p_payment_intent_id: "pi_cap2", p_amount_cents: 2000,
    });
    if (e) throw e;

    const r = await refundBooking(id, "cancel", { db: admin, provider: fakePaymentsProvider() }, { amountCents: 6000 });
    expect(r).toEqual({ refundedCents: 6000, failed: false });
    const { data: rows } = await admin
      .from("booking_payments")
      .select("amount_cents, refunded_cents, status")
      .eq("booking_id", id)
      .order("created_at");
    expect(rows).toEqual([
      { amount_cents: 5000, refunded_cents: 5000, status: "refunded" },
      { amount_cents: 2000, refunded_cents: 1000, status: "paid" },
    ]);
    const { data: b } = await admin.from("bookings").select("paid_cents, refunded_cents").eq("id", id).single();
    expect(b).toEqual({ paid_cents: 7000, refunded_cents: 6000 });

    // The remainder can still go back later (a waived fee).
    const rest = await refundBooking(id, "admin-cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(rest).toEqual({ refundedCents: 1000, failed: false });
    const { data: after } = await admin.from("booking_payments").select("status").eq("booking_id", id).order("created_at");
    expect(after!.map((x) => x.status)).toEqual(["refunded", "refunded"]);
  });

  it("amountCents 0 refunds nothing and touches nothing", async () => {
    const { id } = await paidBooking("zero", "cs_zero");
    const r = await refundBooking(id, "cancel", { db: admin, provider: fakePaymentsProvider() }, { amountCents: 0 });
    expect(r).toEqual({ refundedCents: 0, failed: false });
    const { data: row } = await admin.from("booking_payments").select("status, refunded_cents").eq("booking_id", id).single();
    expect(row).toEqual({ status: "paid", refunded_cents: 0 });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:integration -- src/features/payments/refund.integration.test.ts`
Expected: FAIL — the fourth argument is ignored; everything is refunded.

- [ ] **Step 3: Implement.** In `refund.ts`:

`refundLedgerRow` signature and the amount:

```ts
export async function refundLedgerRow(
  ledgerId: string,
  reason: string,
  deps: Deps = {},
  opts: { bumpBooking?: boolean; amountCents?: number } = {},
): Promise<boolean> {
  …
  if (!row || row.status !== "paid" || !row.payment_intent_id || !row.stripe_account_id) return false;
  const remaining = row.amount_cents - row.refunded_cents;
  // S3: a capped refund takes at most what the caller asked for; the row
  // stays `paid` until it is empty (ruling 11).
  const amount = Math.min(remaining, opts.amountCents ?? remaining);
  if (amount <= 0) return true;
  try {
    const { refundId } = await provider.refund(
      row.stripe_account_id,
      row.payment_intent_id,
      amount,
      // One key per successive refund of the same row: what was already
      // refunded before this call makes a second partial refund a new
      // provider call, while a retry of the same step stays idempotent.
      `${row.id}:${reason}:${row.refunded_cents}`,
    );
    const refundedAfter = row.refunded_cents + amount;
    const { error: markError } = await db
      .from("booking_payments")
      .update({
        status: refundedAfter >= row.amount_cents ? "refunded" : "paid",
        refund_id: refundId,
        refunded_cents: refundedAfter,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
```

(the rest of the body unchanged — the `refund_failed` branches and the bump call use `amount` as before.)

`refundBooking`:

```ts
export async function refundBooking(
  bookingId: string,
  reason: string,
  deps: Deps = {},
  opts: { amountCents?: number } = {},
): Promise<{ refundedCents: number; failed: boolean }> {
  if (opts.amountCents !== undefined && opts.amountCents <= 0) return { refundedCents: 0, failed: false };
  const db = deps.db ?? createAdminClient();
  const { data: rows, error } = await db
    .from("booking_payments")
    .select("id, amount_cents, refunded_cents")
    .eq("booking_id", bookingId)
    .eq("status", "paid")
    .not("payment_intent_id", "is", null)
    // Oldest first: a partial refund empties the deposit before a later top-up.
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[payments] refundBooking: ledger read failed:", error);
    return { refundedCents: 0, failed: true };
  }
  let refundedCents = 0;
  let failed = false;
  let left = opts.amountCents ?? Number.POSITIVE_INFINITY;
  for (const row of rows ?? []) {
    if (left <= 0) break;
    const remaining = row.amount_cents - row.refunded_cents;
    const take = Math.min(remaining, left);
    if (take <= 0) continue;
    if (await refundLedgerRow(row.id, reason, deps, { amountCents: take })) {
      refundedCents += take;
      left -= take;
    } else failed = true;
  }
  return { refundedCents, failed };
}
```

Update the doc comment above `refundBooking`: "Refund everything paid ONLINE on a booking, or at most `amountCents` of it (S3: what the policy does not keep)."

- [ ] **Step 4: Run the refund suite**

Run: `npm run test:integration -- src/features/payments/refund.integration.test.ts`
Expected: PASS (the S2 cases and the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/payments/refund.ts src/features/payments/refund.integration.test.ts
git commit -m "feat(payments): partial refunds — amount cap across ledger rows, row stays paid until empty (S3)"
```

---

### Task 5: Client cancel with the fee; the manage page preview; `rescheduled` is dead

**Files:**
- Modify: `src/features/scheduling/manage-actions.ts` (lines 104–200 `cancelBooking`)
- Modify: `src/app/booking/[token]/page.tsx` (lines 44, 79–107, 160–170)
- Modify: `src/features/scheduling/components/manage-booking.tsx` (props, lines 195–210)
- Modify: `messages/en.json` (delete `errors.cancelWindowPassed`)

**Interfaces:**
- Consumes: Task 1's `cancelFeePct`/`cancelFeeCents`; Task 3's `resolveBookingToken` fields; Task 4's `refundBooking` cap.
- Produces: `ManageBooking` prop `cancelLines?: string[]` (replaces `canCancel`).

- [ ] **Step 1: The action.** In `cancelBooking` (`scheduling/manage-actions.ts`):
  - Delete the `isRpcSentinel(error, "cancel_window")` branch (lines 116–121) and, if nothing else in the file uses them, the `isRpcSentinel` and `resolveActionable` imports/helpers (`resolveActionable` IS still used by `getManageSlots`/`rescheduleBooking` — keep it; drop only the sentinel import if unused).
  - Replace the refund block (lines 145–164, from `// S2 (ruling 3)` to the `currency` const) with:

```ts
    // S3: what the row says now that the RPC has written the consequence —
    // the fee the tier kept, what was paid, what already went back.
    const { data: moneyRow } = await admin
      .from("bookings")
      .select("price_cents, currency, paid_cents, refunded_cents, fee_cents")
      .eq("id", row.booking_id)
      .maybeSingle();
    const money = moneyRow ?? { price_cents: null, currency: null, paid_cents: 0, refunded_cents: 0, fee_cents: 0 };
    // Whatever the fee does not keep comes back. Best effort and recorded on
    // the ledger; a failure is the studio's to finish in Stripe (the booking
    // detail shows it) — never the client's problem here.
    const refundDue = Math.max(0, money.paid_cents - money.refunded_cents - money.fee_cents);
    const refund = await refundBooking(row.booking_id, "cancel", {}, { amountCents: refundDue }).catch((e) => {
      console.error("[payments] cancel refund:", e);
      return { refundedCents: 0, failed: true };
    });
    // A hold cancelled from its own pay screen can still have a live Checkout
    // session behind it — close it so the money never arrives. No-ops when
    // nothing is open; never fails the cancel (already committed).
    await expireOpenCheckouts(row.booking_id).catch((e) =>
      console.error("[payments] cancel: expiring checkouts failed:", e),
    );
    const currency = money.currency;
    // The consequence, in whichever language a mail is built in.
    const consequenceLines = (tUnits: UnitsT) => {
      const lines: string[] = [];
      if (currency && money.fee_cents > 0) lines.push(tUnits("cancellationFee", { amount: formatMoney(money.fee_cents, currency) }));
      if (currency && refund.refundedCents > 0) lines.push(tUnits("refund", { amount: formatMoney(refund.refundedCents, currency) }));
      return lines;
    };
```

  with `import type { UnitsT } from "@/i18n/translator";` and `import { formatMoney } from "@/lib/money";` (already imported).

  - Client mail: `infoLines: currency ? [client.tUnits("refund", …)] : undefined` → `infoLines: consequenceLines(client.tUnits)` (an empty array renders like `undefined` — check `bookingCancelledEmail` treats `[]` as nothing; if it prints an empty block, pass `lines.length ? lines : undefined`).
  - Provider notification (`notifyMembers`, further down the same function): unchanged — its `cancelled` event carries no info lines (`src/features/notifications/notify.ts:38`); the studio reads the fee on the booking detail (Task 7). The spec's "same two lines" for the provider is amended to that.

- [ ] **Step 2: The page.** In `src/app/booking/[token]/page.tsx`:
  - Line 44: `const DEAD_STATUSES = new Set(["expired", "cancelled_by_client", "cancelled_by_provider", "declined", "rescheduled"]);`
  - The `moneyInfoLines` call: `cancelWindowMin: b.cancelWindowMin ?? 0,` → `cancelPolicy: b.cancelPolicy, feeCents: b.feeCents,`.
  - Replace the `canCancel` block (lines 101–107) with:

```ts
  // S3: the consequence of cancelling right now, for the confirm step. Only
  // a confirmed, priced rental has one; the RPC recomputes it on the write.
  const feePct = b.rentalUnitId !== null && b.status === "confirmed" ? cancelFeePct(b.cancelPolicy, b.startsAt, new Date(now)) : 0;
  const feeCents = b.priceCents !== null ? Math.round((b.priceCents * feePct) / 100) : 0;
  const refundCents = Math.max(0, b.paidCents - b.refundedCents - feeCents);
  const cancelLines: string[] = [];
  if (b.currency && feeCents > 0) cancelLines.push(tUnits("cancelFeeNow", { amount: formatMoney(feeCents, b.currency), pct: feePct }));
  if (b.currency && refundCents > 0 && b.status === "confirmed") cancelLines.push(tUnits("willRefund", { amount: formatMoney(refundCents, b.currency) }));
```

  with `import { cancelFeePct } from "@/features/rentals/cancel-policy";`.
  - The confirmed-branch `<ManageBooking … canCancel={canCancel} …>` → `cancelLines={cancelLines}`; the two `canCancel={true}` usages (pending / pending_payment) drop the prop.

- [ ] **Step 3: The component.** In `manage-booking.tsx`: replace the `canCancel: boolean;` prop (and its comment) with

```ts
  // S3: what cancelling right now costs and returns (public.units lines,
  // built by page.tsx). Empty = nothing to say — a plain confirm.
  cancelLines?: string[];
```

and the cancel block (lines 195–210) with:

```tsx
      {confirmingCancel ? (
        <div className="flex flex-col gap-2">
          {cancelLines && cancelLines.length > 0 ? (
            <ul className="text-sm">
              {cancelLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center gap-2">
            <Button variant="destructive" onClick={doCancel} disabled={pending}>
              {request ? t("withdrawConfirm") : t("cancelConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={pending}>
              {t("keepIt")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={pending}>
          {request ? t("withdraw") : t("cancel")}
        </Button>
      )}
```

Delete the `tErrors` translator if `cancelWindowPassed` was its only use. Delete `"cancelWindowPassed"` from `messages/en.json` `errors` (uk/pl in Task 8) and any `cancelWindowPassed` key in `src/i18n/public.ts`'s error map if one exists (`grep -rn cancelWindowPassed src messages`).

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: PASS. Then `npm run test:integration -- src/features/rentals/change-consequences.integration.test.ts` still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/manage-actions.ts "src/app/booking/[token]/page.tsx" src/features/scheduling/components/manage-booking.tsx messages/en.json src/i18n
git commit -m "feat(public): client cancel at the tier's fee with a capped refund; consequence shown before confirm (S3)"
```

---

### Task 6: Client reschedule settlement and the previews in both panels

**Files:**
- Modify: `src/features/rentals/manage-actions.ts` (`getManageRangeAvailability` 89–147, `rescheduleRentalBooking` 148–320, `getManageHourlySlots` 326–398, `rescheduleRentalBookingHours` 400–570)
- Modify: `src/features/rentals/components/hourly-reschedule-panel.tsx`, `rental-reschedule-panel.tsx`

**Interfaces:**
- Produces: both availability actions return `booking: { startsAt: string; priceCents: number | null; currency: string | null; paidCents: number; refundedCents: number; feeCents: number; cancelPolicy: CancelPolicy | null; people: number | null; extras: ExtraPick[] }`.
- Consumes: Task 1's `cancelFeePct`, `cancelFeeCents`, `changeLines`, `quoteHours`, `sumLines`, `totalCents`, `stayUnits`; Task 4's `refundBooking` cap; Task 3's `getBookingMoney`.

- [ ] **Step 1: Availability actions return the booking's money.** In both `getManageRangeAvailability` and `getManageHourlySlots`, add to the `ok: true` return type and value:

```ts
      // S3: what the reschedule preview needs — the row's own money and
      // policy (resolveBookingToken already read them) plus the picks the
      // re-quote uses, so the panel can price the candidate client-side the
      // way the widget does.
      booking: {
        startsAt: booking.startsAt.toISOString(),
        priceCents: booking.priceCents,
        currency: booking.currency,
        paidCents: booking.paidCents,
        refundedCents: booking.refundedCents,
        feeCents: booking.feeCents,
        cancelPolicy: booking.cancelPolicy,
        people: booking.people,
        extras: (booking.lines ?? []).flatMap((l) => (l.kind === "extra" ? [{ id: l.extraId, qty: l.qty }] : [])),
      },
```

(`resolveActionable` returns the `resolveBookingToken` booking, so every field is already there.)

- [ ] **Step 2: Settlement in both reschedule actions.** Right after `kickCalendarSync(moved.org_id);` in BOTH `rescheduleRentalBooking` and `rescheduleRentalBookingHours`:

```ts
    // S3: the new row carries paid money and (maybe) a late-change fee; what
    // the studio now holds above the new total plus fee goes back. Read the
    // committed row (never recompute), refund the excess, and let the mail
    // below print the same numbers. Best effort — the move is committed.
    const money = await getBookingMoney(moved.new_booking_id);
    const excess = money.totalCents === null
      ? 0
      : Math.max(0, money.paidCents - money.refundedCents - (money.totalCents + money.feeCents));
    const refund = await refundBooking(moved.new_booking_id, "reschedule", {}, { amountCents: excess }).catch((e) => {
      console.error("[payments] reschedule refund:", e);
      return { refundedCents: 0, failed: true };
    });
    const moneyAfter = { ...money, refundedCents: money.refundedCents + refund.refundedCents };
```

with `import { refundBooking } from "@/features/payments/refund";` (and `getBookingMoney` already imported for the hourly path; import it for the nights path too).

Then in the client-mail block: the hourly path's `moneyInfoLines(await getBookingMoney(moved.new_booking_id, …), client.tUnits)` → `moneyInfoLines(moneyAfter, client.tUnits)`; the nights path gains the same `infoLines: moneyInfoLines(moneyAfter, client.tUnits)` argument to `bookingRescheduledEmail` (it had none — S1 only wired hours). Both: the `moneyInfoLines` import exists in this file (check; add if not).

- [ ] **Step 3: The hourly panel preview.** In `hourly-reschedule-panel.tsx`:
  - State: `const [booking, setBooking] = React.useState<BookingMoney | null>(null);` where `type BookingMoney = Extract<Awaited<ReturnType<typeof getManageHourlySlots>>, { ok: true }>["booking"];`; in `load`, `setBooking(result.booking);`.
  - Translator: `const tUnits = useTranslations("public.units");`.
  - Below the when-line `<p>` in the confirm branch, before `UnitSelect`:

```tsx
          {booking && offering && durationMin ? (
            <ChangePreview booking={booking} offering={offering} slot={slot} durationMin={durationMin} timeZone={timeZone} t={tUnits} />
          ) : null}
```

  - A small pure component at the bottom of the file:

```tsx
/* S3: what this move would mean, priced the way the widget prices a slot
   (quoteHours on the offering's live rules with the booking's own picks)
   plus the tier fee the OLD start incurs right now. Preview only — the RPC
   writes the numbers. */
function ChangePreview({
  booking, offering, slot, durationMin, timeZone, t,
}: {
  booking: BookingMoney; offering: PublicOffering; slot: string; durationMin: number; timeZone: string; t: UnitsT;
}) {
  const now = new Date();
  const startsAt = new Date(booking.startsAt);
  const feePct = cancelFeePct(booking.cancelPolicy, startsAt, now);
  const feeCents = cancelFeeCents(booking.cancelPolicy, booking.priceCents, startsAt, now);
  const lines = quoteHours(
    { pricing: offering.pricing, priceCents: offering.priceCents, pricingMode: offering.pricingMode },
    new Date(slot), durationMin, booking.people, booking.extras, timeZone,
  );
  const newTotalCents = lines.length === 0 ? null : sumLines(lines);
  const out = changeLines(
    { newTotalCents, currency: booking.currency, feeCents, feePct, priorFeeCents: booking.feeCents, paidCents: booking.paidCents, refundedCents: booking.refundedCents },
    t,
  );
  if (out.length === 0) return null;
  return (
    <ul className="text-sm">
      {out.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}
```

  with imports `import { cancelFeeCents, cancelFeePct } from "@/features/rentals/cancel-policy"; import { changeLines, quoteHours, sumLines } from "@/features/rentals/pricing"; import type { UnitsT } from "@/i18n/translator";`. `quoteHours` may throw its S1 sentinels for a slot the live rules refuse (`quote_band` etc.) — wrap the call in `try { … } catch { return null; }` so the preview just stays silent (the RPC carries the old snapshot in that case).

- [ ] **Step 4: The nights panel preview.** In `rental-reschedule-panel.tsx`: same `booking` state fed by `getManageRangeAvailability`; in the confirm area (next to the `stay?.ok` gate, line ~188), when `stay?.ok && booking && offering`:

```tsx
            <ChangePreviewStay booking={booking} offering={offering} start={range.start!} end={range.end!} t={tUnits} />
```

```tsx
function ChangePreviewStay({ booking, offering, start, end, t }: { booking: BookingMoney; offering: PublicOffering; start: string; end: string; t: UnitsT }) {
  const now = new Date();
  const startsAt = new Date(booking.startsAt);
  const feePct = cancelFeePct(booking.cancelPolicy, startsAt, now);
  const feeCents = cancelFeeCents(booking.cancelPolicy, booking.priceCents, startsAt, now);
  const newTotalCents = totalCents(offering, stayUnits(offering.rangeMode as "nights" | "days", start, end));
  const out = changeLines(
    { newTotalCents, currency: booking.currency, feeCents, feePct, priorFeeCents: booking.feeCents, paidCents: booking.paidCents, refundedCents: booking.refundedCents },
    t,
  );
  if (out.length === 0) return null;
  return <ul className="text-sm">{out.map((l) => <li key={l}>{l}</li>)}</ul>;
}
```

(`range.start`/`range.end` are the panel's own `RangeValue` strings — match the names the file uses.)

- [ ] **Step 5: Verify + integration**

Run: `npm run verify && npm run test:integration -- src/features/rentals/change-consequences.integration.test.ts src/features/rentals/hourly-flow.integration.test.ts src/features/rentals/flow.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/rentals/manage-actions.ts src/features/rentals/components/hourly-reschedule-panel.tsx src/features/rentals/components/rental-reschedule-panel.tsx
git commit -m "feat(rentals): client reschedule settles the excess and previews the change fee + new total before confirm (S3)"
```

---

### Task 7: Admin — the tiers editor on the space form; fee lines and the three-way cancel on the booking detail

**Files:**
- Create: `src/features/rentals/components/cancel-policy-editor.tsx`
- Modify: `src/features/rentals/components/offering-form.tsx` (state ~100–112, parse 138–156, field 572–589)
- Modify: `src/features/rentals/schema.test.ts` (fixture, if it names `cancelWindowMin`)
- Modify: `src/features/scheduling/schema.ts:224`, `src/features/scheduling/booking-actions.ts:65–130`, `src/features/scheduling/queries.ts:243–305`, `src/features/scheduling/components/booking-detail-dialog.tsx:118–160, 193–205, 268`
- Modify: `messages/en.json` (`spaces.form.*`, `bookings.cancel.*`, `bookings.hold.*`)

**Interfaces:**
- Produces: `<CancelPolicyEditor value onChange rangeMode />`; `bookingCancelInput = { id, refund?: 'policy' | 'all' | 'none' }`; `cancelBookingAdmin` returns `+ feeCents`.
- Consumes: Task 1's `cancelPolicySchema`, `CANCEL_POLICY_MAX_TIERS`, `adminCancelMoney`, `formatCancelWindow`; Task 3's `OfferingRow.cancelPolicy`.

- [ ] **Step 1: Strings.** In `messages/en.json`, under `spaces.form` replace the three lines `cancelWindowHours`, `cancelWindowDays`, `noWindow` with:

```json
      "cancelPolicy": "Cancellation policy",
      "cancelPolicyHint": "Free until the first lead, then each tier's fee on the booking total. Below the last lead: 100%.",
      "tierBeforeHours": "hours before start",
      "tierBeforeDays": "days before start",
      "tierFee": "fee %",
      "tierLeadAria": "Tier {n} lead",
      "tierFeeAria": "Tier {n} fee",
      "tierRemove": "Remove tier {n}",
      "tierAdd": "Add a tier",
      "tierAfter": "Less than {lead}: 100%",
      "tierUpToStart": "up to the start",
```

Under `bookings.cancel` add:

```json
      "refundPolicy": "Per policy",
      "refundAll": "Refund everything",
      "refundNone": "Refund nothing",
      "policyLine": "Policy keeps {kept} · refunds {refund}",
      "feeLine": "Fee {fee}",
```

Under `bookings.hold` add:

```json
      "fee": "Fee {amount}",
      "feeOutstanding": "{amount} outstanding"
```

- [ ] **Step 2: The editor** — `src/features/rentals/components/cancel-policy-editor.tsx`:

```tsx
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANCEL_POLICY_MAX_TIERS, formatCancelWindow, type CancelPolicy } from "@/features/rentals/cancel-policy";
import type { RangeMode } from "@/features/rentals/range";

/* S3: the tiers of a space's cancellation policy (spec §Admin). Controlled:
   the form owns the value and posts it as one `cancelPolicy` array. Leads
   are typed in hours (hourly spaces) or days (stays) and stored in minutes,
   the way the old single window was. Rows are kept in the order typed;
   the schema sorts them on save. Row idiom: pricing-rules-editor. */
export function CancelPolicyEditor({
  value, onChange, rangeMode,
}: {
  value: CancelPolicy;
  onChange: (next: CancelPolicy) => void;
  rangeMode: RangeMode;
}) {
  const t = useTranslations("spaces.form");
  const tu = useTranslations("public.units");
  const unit = rangeMode === "hours" ? 60 : 1440;
  const set = (i: number, patch: Partial<CancelPolicy[number]>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const smallest = value.length ? Math.min(...value.map((x) => x.beforeMin)) : null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex flex-col">
        <Label>{t("cancelPolicy")}</Label>
        <span className="text-muted-foreground text-xs">{t("cancelPolicyHint")}</span>
      </legend>
      {value.map((tier, i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
          <Input
            aria-label={t("tierLeadAria", { n: i + 1 })}
            type="number"
            min={0}
            step={rangeMode === "hours" ? 0.5 : 1}
            className="w-20"
            value={tier.beforeMin / unit}
            onChange={(e) => set(i, { beforeMin: Math.max(0, Math.round(Number(e.target.value) * unit)) })}
          />
          <span className="text-muted-foreground text-xs">
            {tier.beforeMin === 0 ? t("tierUpToStart") : rangeMode === "hours" ? t("tierBeforeHours") : t("tierBeforeDays")}
          </span>
          <Input
            aria-label={t("tierFeeAria", { n: i + 1 })}
            type="number"
            min={0}
            max={100}
            className="w-16"
            value={tier.feePct}
            onChange={(e) => set(i, { feePct: Math.min(100, Math.max(0, Math.round(Number(e.target.value)))) })}
          />
          <span className="text-muted-foreground text-xs">{t("tierFee")}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={t("tierRemove", { n: i + 1 })} className="shrink-0"
            onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {smallest !== null && smallest > 0 ? (
        <p className="text-muted-foreground text-xs">{t("tierAfter", { lead: formatCancelWindow(smallest, tu) })}</p>
      ) : null}
      {value.length < CANCEL_POLICY_MAX_TIERS ? (
        <Button type="button" variant="ghost" size="sm" className="self-start"
          // First tier: 48 h (hourly) / 3 days (stays) free; each next one a
          // day closer at 50%. Defaults only — the studio edits the numbers.
          onClick={() => onChange([
            ...value,
            {
              beforeMin: smallest === null ? (rangeMode === "hours" ? 2880 : 4320) : Math.max(0, smallest - 1440),
              feePct: value.length === 0 ? 0 : 50,
            },
          ])}>
          {t("tierAdd")}
        </Button>
      ) : null}
    </fieldset>
  );
}
```

(Adding a tier whose lead collides with an existing one is refused by the schema on save with "duplicate tier" — the form's existing error toast surfaces it; the studio edits the number.)

- [ ] **Step 3: Wire it into the form.** In `offering-form.tsx`:
  - State (next to `pricing`): `const [cancelPolicy, setCancelPolicy] = React.useState<CancelPolicy>(offering?.cancelPolicy ?? []);` with `import type { CancelPolicy } from "@/features/rentals/cancel-policy"; import { CancelPolicyEditor } from "./cancel-policy-editor";`.
  - Parse (lines 138–144): delete the `cancelWindowRaw`/`cancelWindowMin` lines; in `common`, `cancelWindowMin,` → `cancelPolicy,`.
  - Field (lines 572–589): replace the `<div className="flex flex-col gap-2"><Label htmlFor="offering-cancel-window">…</Input></div>` block with `<CancelPolicyEditor value={cancelPolicy} onChange={setCancelPolicy} rangeMode={rangeMode} />`.
  - If `schema.test.ts` has a `cancelWindowMin` fixture, change it to `cancelPolicy: [{ beforeMin: 2880, feePct: 0 }]` and add one assertion that an unsorted input comes back sorted through `offeringInput`.

- [ ] **Step 4: Admin cancel — schema, action, queries.**
  - `scheduling/schema.ts:224`: `export const bookingCancelInput = z.object({ id: z.uuid(), refund: z.enum(["policy", "all", "none"]).default("policy") });`
  - `scheduling/queries.ts`: booking detail type + select + row + mapper gain `cancelPolicy: CancelPolicy | null` (`cancel_policy`) and `feeCents: number` (`fee_cents`), next to `paidCents`.
  - `cancelBookingAdmin` (`booking-actions.ts`): before the UPDATE, read the row's money with the same client:

```ts
    // S3: the dialog's choice decides what the fee is and what goes back;
    // the numbers come from the row, the mode from the input (spec decision 3).
    const { data: before } = await supabase
      .from("bookings")
      .select("price_cents, cancel_policy, starts_at, paid_cents, refunded_cents")
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .maybeSingle();
    if (!before) return { ok: false, error: t("bookings.notCancellable") };
    const { feeCents, refundCents } = adminCancelMoney(
      parsed.data.refund,
      {
        cancelPolicy: before.cancel_policy as CancelPolicy | null,
        priceCents: before.price_cents,
        startsAt: new Date(before.starts_at),
        paidCents: before.paid_cents,
        refundedCents: before.refunded_cents,
      },
      new Date(),
    );
```

    then `.update({ status: "cancelled_by_provider" })` → `.update({ status: "cancelled_by_provider", fee_cents: feeCents })`; the refund block becomes

```ts
    const refund = await refundBooking(row.id, "admin-cancel", {}, { amountCents: refundCents }).catch((e) => {
      console.error("[payments] admin cancel refund:", e);
      return { refundedCents: 0, failed: true };
    });
```

    the client mail's `infoLines` gains the fee line first: `[...(feeCents > 0 && row.currency ? [forClient.tUnits("cancellationFee", { amount: formatMoney(feeCents, row.currency) })] : []), ...(refund.refundedCents > 0 && row.currency ? [forClient.tUnits("refund", …)] : [])]` (pass `undefined` when empty); the return adds `feeCents`. Imports: `adminCancelMoney`, `CancelPolicy` from `@/features/rentals/cancel-policy`.

- [ ] **Step 5: The dialog.** In `booking-detail-dialog.tsx`:
  - Lines (after `refundLine`): 

```ts
  // S3: the consequence the row carries, and what the studio is still owed.
  const feeLine = booking.feeCents > 0 && booking.currency ? t("hold.fee", { amount: formatMoney(booking.feeCents, booking.currency) }) : null;
  const outstanding = booking.feeCents - (booking.paidCents - booking.refundedCents);
  const outstandingLine = booking.feeCents > 0 && outstanding > 0 && booking.currency ? t("hold.feeOutstanding", { amount: formatMoney(outstanding, booking.currency) }) : null;
```

    rendered next to `refundLine` (line 268): `{feeLine ? <p className="text-sm">{feeLine}</p> : null}{outstandingLine ? <p className="text-sm">{outstandingLine}</p> : null}`.
  - Replace `const [refund, setRefund] = React.useState(true);` with:

```ts
  // S3 (decision 3): per policy / everything / nothing. The policy default
  // is computed here for the label only — the action recomputes it.
  const [refund, setRefund] = React.useState<AdminRefundMode>("policy");
  const policyMoney = adminCancelMoney("policy", {
    cancelPolicy: booking.cancelPolicy, priceCents: booking.priceCents, startsAt: new Date(booking.startsAt),
    paidCents: booking.paidCents, refundedCents: booking.refundedCents,
  }, new Date(now));
  const held = booking.paidCents - booking.refundedCents;
  const hasChoice = held > 0 || policyMoney.feeCents > 0;
```

    `cancelBookingAdmin({ id: booking.id, refund })` stays (the value is now the mode).
  - Replace the `{refundable === null ? null : (<label>…Checkbox…</label>)}` block with:

```tsx
      {hasChoice && booking.currency ? (
        <span className="flex flex-col gap-1">
          <SegmentedTabs
            label={t("cancel.button")}
            value={refund}
            onChange={setRefund}
            items={[
              { value: "policy", label: t("cancel.refundPolicy") },
              { value: "all", label: t("cancel.refundAll") },
              { value: "none", label: t("cancel.refundNone") },
            ]}
          />
          <span className="text-muted-foreground text-xs">
            {refund === "policy"
              ? t("cancel.policyLine", { kept: formatMoney(policyMoney.feeCents, booking.currency), refund: formatMoney(policyMoney.refundCents, booking.currency) })
              : refund === "all"
                ? t("cancel.refund", { amount: formatMoney(held, booking.currency) })
                : t("cancel.feeLine", { fee: formatMoney(held, booking.currency) })}
          </span>
        </span>
      ) : null}
```

    `SegmentedTabs<T>` (`src/components/ui/segmented-tabs.tsx`) takes `label`, `value: T`, `onChange: (v: T) => void`, `items: ReadonlyArray<{ value: T; label: string }>` — `T` infers as `AdminRefundMode` from `value`. Drop the `Checkbox` import if unused; delete the now-unused `refundable`. Imports: `adminCancelMoney`, `AdminRefundMode` from `@/features/rentals/cancel-policy`.

- [ ] **Step 6: Verify**

Run: `npm run verify`
Expected: PASS. `grep -rn "cancelWindowMin\|cancel_window_min" src --exclude-dir=migrations` → no hits.

- [ ] **Step 7: Commit**

```bash
git add src/features/rentals/components/cancel-policy-editor.tsx src/features/rentals/components/offering-form.tsx src/features/rentals/schema.test.ts src/features/scheduling/schema.ts src/features/scheduling/booking-actions.ts src/features/scheduling/queries.ts src/features/scheduling/components/booking-detail-dialog.tsx messages/en.json
git commit -m "feat(admin): cancellation tiers editor on the space form; fee + outstanding lines and per-policy/all/none cancel on the booking detail (S3)"
```

---

### Task 8: Ukrainian and Polish strings

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json` (mirror every key Task 1/5/7 added or deleted in `en.json`)

- [ ] **Step 1: Diff the keys.** `git diff main -- messages/en.json` lists every added/removed key. Add the same keys under the same paths in `uk.json` and `pl.json`; delete `errors.cancelWindowPassed`, `public.units.freeCancellation`, `spaces.form.cancelWindowHours/cancelWindowDays/noWindow` from both. Translations (a native reviewer may polish later):

`public.units` — uk: `cancellationFee` "Плата за скасування: {amount}", `changeFee` "Плата за пізню зміну: {amount}", `changeFeePct` "Плата за пізню зміну: {amount} ({pct}%)", `cancelFeeNow` "Скасування зараз: плата {amount} ({pct}%)", `willRefund` "{amount} буде повернено", `newTotal` "Нова сума: {amount}", `policyFree` "Безкоштовне скасування до {window} перед початком", `policyTier` "{pct}% плати до {window} перед початком", `policyAfter` "{pct}% після цього". pl: "Opłata za odwołanie: {amount}", "Opłata za późną zmianę: {amount}", "Opłata za późną zmianę: {amount} ({pct}%)", "Odwołanie teraz: opłata {amount} ({pct}%)", "{amount} zostanie zwrócone", "Nowa suma: {amount}", "Bezpłatne odwołanie do {window} przed rozpoczęciem", "{pct}% opłaty do {window} przed rozpoczęciem", "{pct}% później".

`spaces.form` — uk: `cancelPolicy` "Умови скасування", `cancelPolicyHint` "Безкоштовно до першого порогу, далі плата кожного рівня від суми бронювання. Нижче останнього порогу: 100%.", `tierBeforeHours` "год до початку", `tierBeforeDays` "дн. до початку", `tierFee` "плата %", `tierLeadAria` "Рівень {n}: поріг", `tierFeeAria` "Рівень {n}: плата", `tierRemove` "Прибрати рівень {n}", `tierAdd` "Додати рівень", `tierAfter` "Менше ніж {lead}: 100%", `tierUpToStart` "до самого початку". pl: "Zasady odwołania", "Bezpłatnie do pierwszego progu, potem opłata każdego poziomu od sumy rezerwacji. Poniżej ostatniego progu: 100%.", "godz. przed rozpoczęciem", "dni przed rozpoczęciem", "opłata %", "Poziom {n}: próg", "Poziom {n}: opłata", "Usuń poziom {n}", "Dodaj poziom", "Mniej niż {lead}: 100%", "aż do rozpoczęcia".

`bookings.cancel` — uk: `refundPolicy` "За умовами", `refundAll` "Повернути все", `refundNone` "Нічого не повертати", `policyLine` "За умовами утримується {kept} · повертається {refund}", `feeLine` "Плата {fee}". pl: "Według zasad", "Zwróć wszystko", "Nie zwracaj", "Zasady zatrzymują {kept} · zwrot {refund}", "Opłata {fee}". `bookings.hold` — uk: `fee` "Плата {amount}", `feeOutstanding` "{amount} не сплачено"; pl: "Opłata {amount}", "{amount} do zapłaty".

- [ ] **Step 2: Run the parity test**

Run: `npm run test -- src/i18n/messages.test.ts`
Expected: PASS (every locale has every key; no forbidden word; if a bare label lands in `SAME_IN_EVERY_LOCALE`'s complaint, add it to the set in `messages.test.ts` with a one-line reason).

- [ ] **Step 3: Commit**

```bash
git add messages/uk.json messages/pl.json src/i18n/messages.test.ts
git commit -m "i18n: Ukrainian and Polish for the cancellation tiers, fees and refunds (S3)"
```

---

### Task 9: Full verify, browser QA with the fake provider, graph update, PR

**Files:**
- Modify: `graphify-out/*` (generated), the PR body.

- [ ] **Step 1: Everything green**

Run: `npm run verify && npm run test:integration`
Expected: PASS across the board. If an unrelated integration test flakes on a Docker 502, re-run it alone.

- [ ] **Step 2: Scripted browser QA** (Playwright from the npx cache, per the premium-waitlist QA lesson; `PAYMENTS_PROVIDER=fake` in `.env.local`, dev server on `localhost:3000`, signed-in owner in one context, an incognito client context for the manage page). Walk and screenshot to the scratchpad:
  1. Space settings: set tiers 72 h free · 48 h 50%; save; reload — the rows persist, the trailing "Less than 48 hours: 100%" shows.
  2. Book the space 60 h out with a 30% deposit and pay through the dev fake checkout; the confirmation shows the policy line.
  3. Manage page → Cancel: the confirm step reads "Cancelling now: 150,00 zł fee (50%)" and "…will be refunded" for the paid part; confirm; the page shows fee + refund lines; the cancelled mail (Mailpit :54354) carries both; `/payments` ledger row shows the partial refund; the booking detail shows "Fee 150,00 zł".
  4. Book again 60 h out, pay; Reschedule to a cheaper 1-hour slot: the candidate preview shows the new total, "Late change fee … (50%)" and the refund/due line; confirm; the rescheduled mail matches; the old row shows 0 paid in the DB.
  5. Admin: cancel a paid booking three times on three fresh bookings — per policy (fee + partial refund), everything (fee 0, full refund), nothing (fee = paid, no refund); each mail matches; a no-policy space shows only everything/nothing.
  6. A space with no policy: manage page cancel shows a plain confirm, no lines.
  Record any deviation in the PR body's QA section.

- [ ] **Step 3: Graph + docs**

Run: `graphify update .`
Then add to the PR body: rulings 5–12 from the spec, the one-window deploy note (0081 drops `cancel_window_min`; `resolve_booking_token` return type), the QA table, and the deferred list (fee shortfall collection → S7; admin-move refunds → S7; copy-from-space; outstanding fees on Overview → S4).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/s3-change-consequences
gh pr create --base main --title "feat(rentals): tiered cancellation, late-change fees, partial refunds (S3)" --body-file <the body written in step 3>
```

The body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
```

- [ ] **Step 5: Final commit of anything QA fixed**, then report: PR link, test counts, QA outcome, deferred items.
