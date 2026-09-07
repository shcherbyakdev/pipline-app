# S2 Holds + Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rental booking whose H3 deposit policy says money is due is held (`pending_payment`, blocking the slot) for the org's hold window, paid through Stripe Checkout on the studio's own connected account (P24/BLIK/cards, direct charge, zero application fee), confirmed by webhook, released by the drain when unpaid, and refunded in full when a cancellation H3 already allows happens.

**Architecture:** Migration 0079 adds the `pending_payment`/`expired` statuses, `hold_expires_at` + `paid_cents` + `refunded_cents` on `bookings`, the `booking_payments` ledger, `payment_accounts`, and the org's `payment_hold_min` + `legal`; the create/accept RPCs decide the three-way status in SQL, `apply_booking_payment` confirms atomically and idempotently. A `PaymentsProvider` seam (`src/lib/payments/`, Stripe + fake, mirroring `src/lib/billing/`) wraps Accounts v2 onboarding, Checkout with the `Stripe-Account` header, refunds and Connect webhooks. One pay route creates-or-reuses the Checkout session lazily; one webhook route applies events; the drain gains a fourth phase. `moneyInfoLines` learns paid/balance/refund/pay-now lines so every money surface follows.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql `security definer` RPCs, migrations under `src/db/migrations`), Drizzle schema, zod 4, next-intl (en/uk/pl parity test), Stripe SDK 22.6.1 (`stripe.v2.core.accounts`, `checkout.sessions`, `refunds`, `webhooks`), Vitest (unit + `vitest.integration.config.ts` against the local Supabase stack).

**Spec:** `docs/superpowers/specs/2026-09-07-s2-holds-collection-design.md`

## Global Constraints

- Rentals only (hourly and nights/days). Appointments never enter a hold.
- The studio is the merchant of record: every Stripe call that touches money passes `{ stripeAccount }`; the platform key never creates a PaymentIntent on its own balance; no `application_fee_amount`.
- Connected accounts: `dashboard: 'full'`, `defaults.responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' }`, merchant capabilities `card_payments`, `p24_payments`, `blik_payments` requested, `mcc: '7333'`.
- Money is never TS-computed for display: `paid_cents` / `refunded_cents` / `deposit_cents` are read from the committed row.
- Statuses: `confirmed | pending | pending_payment | declined | expired | cancelled_by_client | cancelled_by_provider | rescheduled`. Every predicate that says `('confirmed','pending')` today — SQL and TS alike — becomes `('confirmed','pending','pending_payment')`.
- Hold window: `orgs.payment_hold_min in (30, 60, 180, 1440)`, default 60; `hold_expires_at = least(now() + hold, starts_at)`.
- Checkout `expires_at` = hold expiry clamped to `[now + 30 min + 30 s, now + 24 h]`.
- `payment_accounts` and `booking_payments` are service_role-only (0076's `calendar_connections` idiom; reads go through server code after `requireOrg`) — a deliberate deviation from the spec's "members select" RLS, noted in the PR.
- Migration is `0079_holds_collection.sql`; journal entry idx 79; snapshot `0079_snapshot.json` (copy `0078_snapshot.json`, add the new columns and the two tables). RPC signatures change (`resolve_booking_token`) → deploy migration and build in one window.
- Webhook mails never carry a manage link (the raw token is never stored; reminder-mail precedent). The payment-due mail, sent by the create/accept actions that hold the token, carries both links.
- Every new user-facing string exists in `messages/en.json`, `uk.json` and `pl.json` (`src/i18n/messages.test.ts` refuses a partial locale) — English lands per task, uk/pl in Task 11. Forbidden words: en `rental`, `offering`, `skip`; uk `оренда`, `офер`, `пропустити`; pl `wynaj`, `pomiń`. No bare `%`/`−` in JSX under `features/**/components`.
- Integration tests: `npm run test:integration -- <file>`; local stack via `npm run setup`, migrations `npm run db:migrate` (a modified migration file needs `npm run db:reset`).
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5`.
- Branch: `feat/s2-holds-collection` off `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/db/migrations/0079_holds_collection.sql` (new) | Statuses, columns, EXCLUDE + helpers, policy, tables, org columns, RPC bodies. |
| `src/db/migrations/meta/_journal.json`, `meta/0079_snapshot.json` | Register the migration. |
| `src/db/schema/scheduling.ts`, `src/db/schema/orgs.ts`, `src/db/schema/payments.ts` (new) | Drizzle columns/tables. |
| `src/features/payments/holds.integration.test.ts` (new) | Every RPC delta against the local stack. |
| `src/lib/payments/provider.ts` (new) | `PaymentsProvider`, `PaymentEvent`, `selectPaymentsProvider`, `paymentsConfigured`, `checkoutExpiresAt`. |
| `src/lib/payments/stripe.ts` (new) | Accounts v2, account links, status, Checkout (direct), expire, refund, Connect webhook parse. |
| `src/lib/payments/fake.ts` (new) | HMAC-signed fake events, fake URLs; dev checkout page in `src/app/dev/payments/checkout/`. |
| `src/lib/payments/provider.test.ts`, `stripe.test.ts`, `fake.test.ts` (new) | Clamp, normalisation, signatures. |
| `src/env-schema.ts`, `src/env.ts` | `PAYMENTS_PROVIDER`, `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `PAYMENTS_FAKE_SECRET`. |
| `src/features/rentals/pricing.ts` + `pricing.test.ts` | `moneyInfoLines` paid / balance / refund / pay-now states. |
| `src/features/scheduling/templates.ts` | `paymentDueEmail`, `paymentReceivedEmail`, `holdExpiredEmail`, `slotLostEmail`; lifecycle keys. |
| `src/features/rentals/hourly-actions.ts`, `public-actions.ts` | Three-way outcome, payment-due mail. |
| `src/features/scheduling/booking-actions.ts` | Accept three-way; admin cancel of holds + refund flag. |
| `src/features/scheduling/manage-actions.ts` | Client cancel refunds. |
| `src/features/scheduling/components/booking-confirmed.tsx`, `src/features/rentals/components/hourly-booking-flow.tsx`, `rental-booking-flow.tsx` | The `payment` outcome panel. |
| `src/features/payments/checkout.ts` (new) | `startCheckout(bookingId)` create-or-reuse. |
| `src/app/booking/[token]/pay/route.ts` (new) | The pay redirect. |
| `src/features/payments/apply.ts` (new) | `applyPaymentEvents` → RPC + side effects. |
| `src/features/payments/confirm-effects.ts` (new) | `sendPaymentReceived(bookingId)`: client mail, `notifyMembers`, `kickCalendarSync`. |
| `src/app/api/payments/webhook/route.ts` (new) + `route.integration.test.ts` | Connect webhook. |
| `src/features/payments/hold-expiry.ts` (new) + `hold-expiry.integration.test.ts` | Drain phase. |
| `src/app/api/scheduling/drain/route.ts` | Fourth phase. |
| `src/features/payments/refund.ts` (new) | `refundBooking(bookingId)`. |
| `src/features/payments/legal.ts` (new) + test | `legalSchema`, `LEGAL_COUNTRIES`. |
| `src/features/payments/queries.ts`, `actions.ts`, `components/stripe-card.tsx`, `components/payment-settings-form.tsx` (new) | `/payments`. |
| `src/app/(dashboard)/payments/page.tsx` (new), `src/components/shell/nav.ts` + `nav.test.ts` | The page and its nav item. |
| `src/features/scheduling/queries.ts`, `detail-bookings.ts`, `src/features/rentals/queries.ts`, `src/lib/booking/public.ts` | Status lists. |
| `src/features/scheduling/components/calendar-grid.tsx`, `booking-detail-dialog.tsx`, `src/features/rentals/components/timeline.tsx` | Hold ghosts, Mark as paid, refund checkbox. |
| `src/lib/tokens/booking.ts`, `src/app/booking/[token]/page.tsx` | Resolver fields; hold / expired / paid states. |
| `src/features/booking-page/render/legal-footer.tsx` (new), `channel-page.tsx` | The legal footer. |
| `messages/{en,uk,pl}.json`, `messages/GLOSSARY.md` | Strings. |

---

### Task 1: Migration 0079 — statuses, ledger, accounts, org settings, RPC deltas

**Files:**
- Create: `src/db/migrations/0079_holds_collection.sql`
- Create: `src/db/migrations/meta/0079_snapshot.json` (copy of `0078_snapshot.json` with the new columns and tables added)
- Modify: `src/db/migrations/meta/_journal.json` (append idx 79)
- Modify: `src/db/schema/scheduling.ts:207-213` (three columns), `src/db/schema/orgs.ts:49` (two columns)
- Create: `src/db/schema/payments.ts`, export it from `src/db/schema/index.ts` (whatever file re-exports the schema modules — grep `export * from "./orgs"`)
- Test: `src/features/payments/holds.integration.test.ts`

**Interfaces:**
- Produces (SQL): `bookings.hold_expires_at timestamptz`, `bookings.paid_cents int`, `bookings.refunded_cents int`; tables `public.booking_payments`, `public.payment_accounts`; `orgs.payment_hold_min int`, `orgs.legal jsonb`; RPCs `update_org_payments(p_org_id uuid, p_hold_min int, p_legal jsonb) returns void` (authenticated), `apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int) returns text` (service_role; `'confirmed' | 'replayed' | 'slot_lost' | 'unknown'`), `mark_booking_paid(p_booking_id uuid) returns uuid` (authenticated); `resolve_booking_token` returns three more columns `hold_expires_at timestamptz, paid_cents int, refunded_cents int`; `accept_booking` may leave the row `pending_payment`; `cancel_booking` accepts `pending_payment`; `rotate_booking_token` accepts `pending_payment`; a reschedule's new row inherits `paid_cents`/`refunded_cents` and the ledger follows it (triggers).
- Produces (Drizzle): `bookingPayments`, `paymentAccounts` tables in `src/db/schema/payments.ts`.

- [ ] **Step 1: Write the failing integration test**

Create `src/features/payments/holds.integration.test.ts` (the preamble is `src/features/rentals/pricing-quote.integration.test.ts:8-120` — `admin`, `anon`, `signedInUser`, `newOrg`, `hoursFixture` — copied verbatim, then these cases):

```ts
/**
 * S2 holds: the create/accept RPCs decide confirmed | pending | pending_payment
 * from the org's payment account + the offering's deposit; a hold blocks the
 * slot under EXCLUDE; apply_booking_payment confirms atomically and
 * idempotently, revives an expired hold when the slot is still free, and
 * reports slot_lost otherwise; cancel/rotate accept holds; the resolver
 * returns the money columns. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { wallTimeToUtc } from "@/features/scheduling/slots";

try { loadEnvFile(".env.local"); } catch { /* CI exports env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const TZ = "Europe/Warsaw";
const at = (local: string) => { const [d, t] = local.split("T"); return wallTimeToUtc(d, t, TZ).toISOString(); };
type Row = Record<string, unknown>;

// --- copy signedInUser / newOrg / hoursFixture from pricing-quote.integration.test.ts,
// --- with hoursFixture's default `pricing` replaced by `price_cents: 10000, pricing_mode: "per_unit",
// --- deposit_type: "percent", deposit_value: 50` (H3 flat 100 zł/h, 50 % deposit).

/** A day well inside the 730-day window, org-local. */
const DAY = "2027-05-10";
let counter = 0;
const slotAt = (hour: number) => at(`${DAY}T${String(hour).padStart(2, "0")}:00`);

async function activeAccount(orgId: string) {
  const { error } = await admin.from("payment_accounts").insert({
    org_id: orgId, stripe_account_id: `acct_test_${orgId.slice(0, 8)}_${counter++}`, status: "active",
  });
  if (error) throw error;
}

async function createHours(handle: string, offeringId: string, hour: number, over: Row = {}) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: null, p_starts_at: slotAt(hour),
    p_duration_min: 60, p_name: "Ola", p_email: `ola${counter++}@example.com`, p_note: null,
    p_token_hash: token.tokenHash, p_people: null, p_extras: [], ...over,
  });
  return { id: data as string | null, error, token: token.token };
}

async function booking(id: string) {
  const { data, error } = await admin.from("bookings")
    .select("status, hold_expires_at, paid_cents, refunded_cents, deposit_cents, starts_at").eq("id", id).single();
  if (error) throw error;
  return data as { status: string; hold_expires_at: string | null; paid_cents: number; refunded_cents: number; deposit_cents: number | null; starts_at: string };
}

async function ledgerRow(bookingId: string, sessionId: string) {
  const { data, error } = await admin.from("booking_payments").insert({
    org_id: (await admin.from("bookings").select("org_id").eq("id", bookingId).single()).data!.org_id,
    booking_id: bookingId, kind: "deposit", provider: "fake", amount_cents: 5000, currency: "PLN",
    status: "pending", checkout_session_id: sessionId,
  }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

describe("create RPC three-way status", () => {
  it("no payment account → confirmed, hold null", async () => {
    const { client, orgId, handle } = await newOrg("noacct");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id, error } = await createHours(handle, offeringId, 10);
    expect(error).toBeNull();
    const b = await booking(id!);
    expect(b.status).toBe("confirmed");
    expect(b.hold_expires_at).toBeNull();
    expect(b.paid_cents).toBe(0);
  });

  it("active account + deposit → pending_payment with a hold ≤ 60 min and ≤ starts_at", async () => {
    const { client, orgId, handle } = await newOrg("hold");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const before = Date.now();
    const { id, error } = await createHours(handle, offeringId, 10);
    expect(error).toBeNull();
    const b = await booking(id!);
    expect(b.status).toBe("pending_payment");
    expect(b.deposit_cents).toBe(5000);
    const hold = new Date(b.hold_expires_at!).getTime();
    expect(hold).toBeGreaterThan(before + 59 * 60_000);
    expect(hold).toBeLessThanOrEqual(before + 61 * 60_000);
  });

  it("active account but deposit none → confirmed", async () => {
    const { client, orgId, handle } = await newOrg("nodep");
    const { offeringId } = await hoursFixture(client, orgId, { deposit_type: "none", deposit_value: null });
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    expect((await booking(id!)).status).toBe("confirmed");
  });

  it("requires_approval wins over the deposit → pending, no hold", async () => {
    const { client, orgId, handle } = await newOrg("appr");
    const { offeringId } = await hoursFixture(client, orgId, { requires_approval: true });
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const b = await booking(id!);
    expect(b.status).toBe("pending");
    expect(b.hold_expires_at).toBeNull();
  });

  it("the org's hold window is honoured (30 min)", async () => {
    const { client, orgId, handle } = await newOrg("win");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { error: e } = await client.rpc("update_org_payments", { p_org_id: orgId, p_hold_min: 30, p_legal: {} });
    expect(e).toBeNull();
    const before = Date.now();
    const { id } = await createHours(handle, offeringId, 10);
    const hold = new Date((await booking(id!)).hold_expires_at!).getTime();
    expect(hold).toBeLessThanOrEqual(before + 31 * 60_000);
  });

  it("a hold blocks the slot: the second insert is 'taken'", async () => {
    const { client, orgId, handle } = await newOrg("block");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const first = await createHours(handle, offeringId, 12);
    expect(first.error).toBeNull();
    const second = await createHours(handle, offeringId, 12);
    expect(second.error?.message).toMatch(/taken/);
  });
});

describe("accept_booking three-way", () => {
  it("pending → pending_payment when the account is active and a deposit is due", async () => {
    const { client, orgId, handle } = await newOrg("acc");
    const { offeringId } = await hoursFixture(client, orgId, { requires_approval: true });
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const { error } = await client.rpc("accept_booking", { p_booking_id: id });
    expect(error).toBeNull();
    const b = await booking(id!);
    expect(b.status).toBe("pending_payment");
    expect(b.hold_expires_at).not.toBeNull();
  });

  it("pending → confirmed without an account", async () => {
    const { client, orgId, handle } = await newOrg("acc2");
    const { offeringId } = await hoursFixture(client, orgId, { requires_approval: true });
    const { id } = await createHours(handle, offeringId, 10);
    await client.rpc("accept_booking", { p_booking_id: id });
    expect((await booking(id!)).status).toBe("confirmed");
  });
});

describe("apply_booking_payment", () => {
  it("confirms a hold once; a replay says replayed", async () => {
    const { client, orgId, handle } = await newOrg("pay");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledgerRow(id!, "cs_pay_1_" + id);
    const { data: r1 } = await admin.rpc("apply_booking_payment", { p_session_id: "cs_pay_1_" + id, p_payment_intent_id: "pi_1", p_amount_cents: 5000 });
    expect(r1).toBe("confirmed");
    const b = await booking(id!);
    expect(b.status).toBe("confirmed");
    expect(b.paid_cents).toBe(5000);
    const { data: r2 } = await admin.rpc("apply_booking_payment", { p_session_id: "cs_pay_1_" + id, p_payment_intent_id: "pi_1", p_amount_cents: 5000 });
    expect(r2).toBe("replayed");
    expect((await booking(id!)).paid_cents).toBe(5000);
    const { data: row } = await admin.from("booking_payments").select("status, payment_intent_id, paid_at").eq("checkout_session_id", "cs_pay_1_" + id).single();
    expect(row).toMatchObject({ status: "paid", payment_intent_id: "pi_1" });
    expect(row!.paid_at).not.toBeNull();
  });

  it("unknown session → unknown", async () => {
    const { data } = await admin.rpc("apply_booking_payment", { p_session_id: "cs_nope", p_payment_intent_id: "pi", p_amount_cents: 1 });
    expect(data).toBe("unknown");
  });

  it("revives an expired hold whose slot is still free", async () => {
    const { client, orgId, handle } = await newOrg("revive");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("bookings").update({ status: "expired" }).eq("id", id!);
    await ledgerRow(id!, "cs_rev_" + id);
    const { data } = await admin.rpc("apply_booking_payment", { p_session_id: "cs_rev_" + id, p_payment_intent_id: "pi_r", p_amount_cents: 5000 });
    expect(data).toBe("confirmed");
    expect((await booking(id!)).status).toBe("confirmed");
  });

  it("slot_lost when the expired hold's slot was taken meanwhile; the ledger row stays paid", async () => {
    const { client, orgId, handle } = await newOrg("lost");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("bookings").update({ status: "expired" }).eq("id", id!);
    const other = await createHours(handle, offeringId, 10);
    expect(other.error).toBeNull();
    await ledgerRow(id!, "cs_lost_" + id);
    const { data } = await admin.rpc("apply_booking_payment", { p_session_id: "cs_lost_" + id, p_payment_intent_id: "pi_l", p_amount_cents: 5000 });
    expect(data).toBe("slot_lost");
    expect((await booking(id!)).status).toBe("expired");
    const { data: row } = await admin.from("booking_payments").select("status").eq("checkout_session_id", "cs_lost_" + id).single();
    expect(row!.status).toBe("paid");
  });
});

describe("holds and the lifecycle RPCs", () => {
  it("cancel_booking withdraws a hold; rotate_booking_token accepts it; resolver returns money columns", async () => {
    const { client, orgId, handle } = await newOrg("life");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id, token } = await createHours(handle, offeringId, 10);
    const { data: res } = await anon.rpc("resolve_booking_token", { p_token: token });
    const r = (res as Row[])[0];
    expect(r.booking_status).toBe("pending_payment");
    expect(r.hold_expires_at).not.toBeNull();
    expect(r.paid_cents).toBe(0);
    expect(r.refunded_cents).toBe(0);
    const fresh = generateAccessToken();
    const { error: rotErr } = await client.rpc("rotate_booking_token", { p_booking_id: id, p_token_hash: fresh.tokenHash });
    expect(rotErr).toBeNull();
    const { data: cancelled, error } = await admin.rpc("cancel_booking", { p_token: fresh.token });
    expect(error).toBeNull();
    expect((cancelled as Row[]).length).toBe(1);
    expect((await booking(id!)).status).toBe("cancelled_by_client");
  });

  it("reschedule refuses a hold", async () => {
    const { client, orgId, handle } = await newOrg("resch");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id, token } = await createHours(handle, offeringId, 10);
    const fresh = generateAccessToken();
    // 0078 signature: (p_old_id, p_unit_id, p_starts_at, p_new_token_hash, p_keep_unit boolean)
    // — read the exact fifth parameter's name at 0078_pricing_rules.sql:315-321 before wiring.
    const { error } = await admin.rpc("reschedule_rental_hours_apply", {
      p_old_id: id, p_unit_id: null, p_starts_at: slotAt(14), p_new_token_hash: fresh.tokenHash, p_keep_unit: false,
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("a reschedule carries paid money and re-points the ledger to the new row", async () => {
    const { client, orgId, handle } = await newOrg("carry");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledgerRow(id!, "cs_carry_" + id);
    await admin.rpc("apply_booking_payment", { p_session_id: "cs_carry_" + id, p_payment_intent_id: "pi_c", p_amount_cents: 5000 });
    const fresh = generateAccessToken();
    const { data: moved, error } = await admin.rpc("reschedule_rental_hours_apply", {
      p_old_id: id, p_unit_id: null, p_starts_at: slotAt(15), p_new_token_hash: fresh.tokenHash, p_keep_unit: false,
    });
    expect(error).toBeNull();
    const newId = ((moved as Row[])[0].booking_id ?? (moved as Row[])[0].id) as string; // whichever column the RPC returns — read 0078's `return query`
    const b = await booking(newId);
    expect(b.status).toBe("confirmed");
    expect(b.paid_cents).toBe(5000);
    const { data: rows } = await admin.from("booking_payments").select("booking_id").eq("checkout_session_id", "cs_carry_" + id);
    expect(rows).toEqual([{ booking_id: newId }]);
  });

  it("mark_booking_paid confirms a hold and writes a manual ledger row", async () => {
    const { client, orgId, handle } = await newOrg("manual");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const { error } = await client.rpc("mark_booking_paid", { p_booking_id: id });
    expect(error).toBeNull();
    const b = await booking(id!);
    expect(b.status).toBe("confirmed");
    expect(b.paid_cents).toBe(5000);
    const { data: rows } = await admin.from("booking_payments").select("provider, status, amount_cents").eq("booking_id", id!);
    expect(rows).toEqual([{ provider: "manual", status: "paid", amount_cents: 5000 }]);
  });

  it("the admin cancel policy lets a member cancel a hold", async () => {
    const { client, orgId, handle } = await newOrg("adm");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const { data, error } = await client.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", id!).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("update_org_payments", () => {
  it("rejects a hold outside the set and a foreign org", async () => {
    const { client, orgId } = await newOrg("org");
    const bad = await client.rpc("update_org_payments", { p_org_id: orgId, p_hold_min: 45, p_legal: {} });
    expect(bad.error).not.toBeNull();
    const other = await newOrg("other");
    const foreign = await other.client.rpc("update_org_payments", { p_org_id: orgId, p_hold_min: 60, p_legal: {} });
    expect(foreign.error?.message).toMatch(/not found/);
    const ok = await client.rpc("update_org_payments", { p_org_id: orgId, p_hold_min: 1440, p_legal: { legalName: "Studio X", taxId: "1234567890" } });
    expect(ok.error).toBeNull();
    const { data } = await admin.from("orgs").select("payment_hold_min, legal").eq("id", orgId).single();
    expect(data).toEqual({ payment_hold_min: 1440, legal: { legalName: "Studio X", taxId: "1234567890" } });
  });
});
```

Note: `reschedule_rental_hours_apply` is `(uuid, uuid, timestamptz, text, boolean)` in 0078; the boolean's name is in the file — match it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- src/features/payments/holds.integration.test.ts`
Expected: FAIL — `payment_accounts` does not exist / `update_org_payments` not found.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0079_holds_collection.sql`:

```sql
-- S2 holds + collection (docs/superpowers/specs/2026-09-07-s2-holds-collection-design.md).
-- A rental booking whose deposit is due on an org with an active payment
-- account is inserted as 'pending_payment' with hold_expires_at, holds its
-- slot under the EXCLUDE guards, is confirmed by apply_booking_payment
-- (webhook) or mark_booking_paid (admin), and is flipped to 'expired' by
-- the drain when the hold lapses.
-- Deploy note: resolve_booking_token's return type changes (drop/create)
-- and five RPC bodies change — migrate and deploy the build in one window.

-- ---------- bookings: statuses + money columns
alter table public.bookings drop constraint bookings_status_check;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','pending','pending_payment','declined','expired',
       'cancelled_by_client','cancelled_by_provider','rescheduled'));
--> statement-breakpoint
alter table public.bookings
  add column hold_expires_at timestamptz,
  add column paid_cents integer not null default 0,
  add column refunded_cents integer not null default 0;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_hold_ck check (status <> 'pending_payment' or hold_expires_at is not null),
  add constraint bookings_paid_ck check (paid_cents >= 0),
  add constraint bookings_refunded_ck check (refunded_cents >= 0 and refunded_cents <= paid_cents);
--> statement-breakpoint
-- The drain's scan: live holds ordered by deadline.
create index bookings_hold_expires_idx on public.bookings (hold_expires_at) where status = 'pending_payment';
--> statement-breakpoint

-- ---------- EXCLUDE guards (0062 bodies, predicate widened): a hold reserves
-- its slot exactly as a pending request does.
alter table public.bookings drop constraint bookings_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending','pending_payment') and staff_id is not null);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_rental_unit_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_rental_unit_no_overlap
  exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending','pending_payment') and rental_unit_id is not null);
--> statement-breakpoint

-- ---------- Free-check helpers (0062 bodies, one predicate widened). They
-- mirror the EXCLUDE predicate: a pre-check that disagrees with the
-- constraint turns an authorised insert into a 23P01.
create or replace function public.staff_is_free(
  p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.staff_id = p_staff_id and b.status in ('confirmed','pending','pending_payment')
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at));
$$;
revoke all on function public.staff_is_free(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.pick_staff_for_slot(
  p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_exclude uuid[], p_candidates uuid[] default null
) returns uuid language sql stable set search_path = '' as $$
  select st.id
  from public.service_staff ss
  join public.staff st on st.id = ss.staff_id
  where ss.service_id = p_service_id and st.active
    and st.id <> all(coalesce(p_exclude, '{}'::uuid[]))
    and (p_candidates is null or st.id = any(p_candidates))
    and public.slot_within_availability(st.id, p_timezone, p_starts_at, p_ends_at)
    and public.staff_is_free(st.id, p_starts_at, p_ends_at, null)
  order by (
      select count(*) from public.bookings b
      where b.staff_id = st.id and b.status in ('confirmed','pending','pending_payment')
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[], uuid[])
  from public, anon, authenticated, service_role;

create or replace function public.rental_unit_is_free(
  p_unit_id uuid, p_timezone text, p_range_mode text, p_occ_start date, p_occ_end date,
  p_turnover int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status in ('confirmed','pending','pending_payment')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and daterange((b.starts_at at time zone p_timezone)::date,
                      greatest((b.starts_at at time zone p_timezone)::date,
                               (b.ends_at at time zone p_timezone)::date
                                 - case when p_range_mode = 'nights' then 1 else 0 end
                                 + p_turnover), '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'));
$$;
revoke all on function public.rental_unit_is_free(uuid, text, text, date, date, int, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.rental_unit_is_free_hours(
  p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_turnover_min int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange((p_starts_at at time zone p_timezone)::date,
                         (p_ends_at   at time zone p_timezone)::date, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status in ('confirmed','pending','pending_payment')
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and tstzrange(b.starts_at, b.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;

-- ---------- Admin cancel seam (0028): a member may also cancel a hold.
drop policy "bookings_update_member" on public.bookings;
--> statement-breakpoint
create policy "bookings_update_member" on public.bookings
  for update to authenticated
  using (org_id in (select public.user_orgs()) and status in ('confirmed','pending_payment'))
  with check (org_id in (select public.user_orgs()) and status = 'cancelled_by_provider');
--> statement-breakpoint

-- ---------- Tables. service_role only (0076's calendar_connections idiom):
-- every read goes through server code after requireOrg, every write through
-- the admin client or a definer RPC.
create table public.payment_accounts (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_account_id text not null unique,
  status text not null default 'onboarding' check (status in ('onboarding','active','restricted')),
  capabilities jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
--> statement-breakpoint
alter table public.payment_accounts enable row level security;
--> statement-breakpoint
revoke all on table public.payment_accounts from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on table public.payment_accounts to service_role;
--> statement-breakpoint

create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('deposit')),
  provider text not null check (provider in ('stripe','fake','manual')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  status text not null check (status in ('pending','processing','paid','failed','expired','refunded','refund_failed')),
  stripe_account_id text,
  checkout_session_id text unique,
  checkout_url text,
  checkout_expires_at timestamptz,
  payment_intent_id text,
  paid_at timestamptz,
  refund_id text,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index booking_payments_booking_id_idx on public.booking_payments (booking_id, created_at desc);
--> statement-breakpoint
alter table public.booking_payments enable row level security;
--> statement-breakpoint
revoke all on table public.booking_payments from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on table public.booking_payments to service_role;
--> statement-breakpoint

-- ---------- orgs: hold window + legal identity (select-only table, 0004 —
-- written by update_org_payments below).
alter table public.orgs
  add column payment_hold_min integer not null default 60,
  add column legal jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table public.orgs
  add constraint orgs_payment_hold_ck check (payment_hold_min in (30, 60, 180, 1440)),
  add constraint orgs_legal_ck check (jsonb_typeof(legal) = 'object');
--> statement-breakpoint

create function public.update_org_payments(p_org_id uuid, p_hold_min int, p_legal jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  if p_hold_min is null or p_hold_min not in (30, 60, 180, 1440) then raise exception 'invalid hold'; end if;
  if p_legal is null or jsonb_typeof(p_legal) <> 'object' then raise exception 'invalid legal'; end if;
  update public.orgs set payment_hold_min = p_hold_min, legal = p_legal where id = p_org_id;
end; $$;
revoke all on function public.update_org_payments(uuid, int, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_org_payments(uuid, int, jsonb) to authenticated;

-- ---------- create_rental_booking_hours (base: 0078): the inserted status
-- becomes three-way and the hold is stamped.
```

Then paste the whole `create or replace function public.create_rental_booking_hours(...)` from `src/db/migrations/0078_pricing_rules.sql:149-234` (`create function` → `create or replace function`; keep the `revoke`/`grant` pair) with exactly these edits:

1. In `declare`, append: `v_pay boolean; v_hold int;`
2. Replace `select o.id, o.timezone, o.currency, o.offers_rentals into v_org` with `select o.id, o.timezone, o.currency, o.offers_rentals, o.payment_hold_min into v_org`.
3. Immediately before `perform pg_advisory_xact_lock(...)`, insert:
   ```sql
   -- S2: a deposit on an org with an active payment account is collected
   -- online — the row is held, not confirmed. Approval still comes first.
   v_pay := coalesce(v_deposit, 0) > 0
        and exists (select 1 from public.payment_accounts pa where pa.org_id = v_org.id and pa.status = 'active');
   v_hold := v_org.payment_hold_min;
   ```
4. In the `insert into public.bookings (...)` column list, append `, hold_expires_at` after `lines, people`; in `values (...)`, replace
   `case when v_off.requires_approval then 'pending' else 'confirmed' end,` with
   ```sql
   case when v_off.requires_approval then 'pending'
        when v_pay then 'pending_payment' else 'confirmed' end,
   ```
   and append after the `people` expression:
   ```sql
   case when (not v_off.requires_approval) and v_pay
        then least(now() + make_interval(mins => v_hold), p_starts_at) end
   ```

Continue the file:

```sql
-- ---------- create_rental_booking (base: 0062, nights/days): same three-way.
```

Paste `create or replace function public.create_rental_booking(...)` from `src/db/migrations/0062_booking_approval.sql:250-370` (with its `revoke`/`grant` pair) and apply the same four edits (its org select is the `select o.id, o.timezone, o.currency, o.offers_rentals into v_org` line — add `o.payment_hold_min`; its deposit variable is `v_deposit`; its insert has no `lines, people` — append `, hold_expires_at` after `terms_accepted_at` and the hold expression after the `terms_accepted_at` value, using `v_starts` instead of `p_starts_at`).

```sql
-- ---------- accept_booking (base: 0063): pending -> pending_payment when a
-- deposit is due on an active account, else confirmed.
create or replace function public.accept_booking(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_pay boolean;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select coalesce(b.deposit_cents, 0) > 0
         and exists (select 1 from public.payment_accounts pa where pa.org_id = b.org_id and pa.status = 'active')
    into v_pay
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs());
  if v_pay is null then raise exception 'not found'; end if;
  -- pending -> confirmed/pending_payment cannot violate the overlap guards:
  -- the row already holds its slot under the widened EXCLUDE (0062/0079).
  update public.bookings b
    set status = case when v_pay then 'pending_payment' else 'confirmed' end,
        hold_expires_at = case when v_pay
          then least(now() + make_interval(mins => (select o.payment_hold_min from public.orgs o where o.id = b.org_id)), b.starts_at) end
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'pending'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then raise exception 'not found'; end if;
  return v_id;
end; $$;
revoke all on function public.accept_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_booking(uuid) to authenticated;

-- ---------- Money follows a reschedule. A reschedule writes a NEW row
-- (rescheduled_from_id → the old one; six RPCs across 0058/0062/0070/0078).
-- Rather than re-issue them, the 0072 carry trigger grows two rules: the new
-- row inherits paid/refunded cents, and the ledger is re-pointed at it after
-- the insert so a later refund finds the money on the live booking.
create or replace function public.carry_booking_locale()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    if new.locale is null then
      select b.locale into new.locale from public.bookings b where b.id = new.rescheduled_from_id;
    end if;
    -- S2: money carries (spec §Flows "Reschedule": paid_cents carries).
    select b.paid_cents, b.refunded_cents into new.paid_cents, new.refunded_cents
      from public.bookings b where b.id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
create or replace function public.carry_booking_payments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rescheduled_from_id is not null then
    update public.booking_payments set booking_id = new.id, updated_at = now()
      where booking_id = new.rescheduled_from_id;
  end if;
  return new;
end; $$;
drop trigger if exists bookings_payments_carry on public.bookings;
create trigger bookings_payments_carry
  after insert on public.bookings
  for each row execute function public.carry_booking_payments();

-- ---------- rotate_booking_token (base: 0064): a hold's link can be resent
-- and is rotated by the accept action.
```

Paste `create or replace function public.rotate_booking_token(...)` from `src/db/migrations/0064_approval_followups.sql` (the function starting at its `create or replace function public.rotate_booking_token` line through its `grant`), replacing `b.status in ('confirmed','pending')` with `b.status in ('confirmed','pending','pending_payment')`.

```sql
-- ---------- cancel_booking (base: 0070): a hold withdraws unconditionally,
-- like a pending request (nothing was paid yet).
```

Paste `create or replace function public.cancel_booking(p_token text)` from `src/db/migrations/0070_booking_title.sql:58-104` (with its `revoke`/`grant`), replacing `and (b.status = 'pending'` with `and (b.status in ('pending','pending_payment')`.

```sql
-- ---------- resolve_booking_token (base: 0078): + hold_expires_at,
-- paid_cents, refunded_cents (return type changes: drop + create).
drop function public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text,
  price_cents int, currency text, deposit_cents int, cancel_window_min int, decline_note text,
  lines jsonb, people int,
  hold_expires_at timestamptz, paid_cents int, refunded_cents int                  -- S2
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, public.booking_title(ro.name, u.name)),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name,
           b.price_cents, b.currency, b.deposit_cents, ro.cancel_window_min, b.decline_note,
           b.lines, b.people,
           b.hold_expires_at, b.paid_cents, b.refunded_cents                          -- S2
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash
      and b.ends_at > now() - interval '30 days';
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon, service_role;

-- ---------- apply_booking_payment: the webhook's one write. Idempotent on
-- the ledger row; confirms a hold, revives an expired hold when the slot is
-- still free, and reports slot_lost otherwise (the caller refunds).
create function public.apply_booking_payment(p_session_id text, p_payment_intent_id text, p_amount_cents int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pay record; v_status text; v_id uuid;
begin
  select bp.id, bp.booking_id, bp.status into v_pay
    from public.booking_payments bp where bp.checkout_session_id = p_session_id for update;
  if v_pay.id is null then return 'unknown'; end if;
  if v_pay.status = 'paid' or v_pay.status = 'refunded' or v_pay.status = 'refund_failed' then return 'replayed'; end if;

  update public.booking_payments
    set status = 'paid', payment_intent_id = p_payment_intent_id, amount_cents = p_amount_cents,
        paid_at = now(), updated_at = now()
    where id = v_pay.id;

  select b.status into v_status from public.bookings b where b.id = v_pay.booking_id for update;
  if v_status = 'pending_payment' then
    update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
      where id = v_pay.booking_id;
    return 'confirmed';
  elsif v_status = 'expired' then
    -- The hold lapsed before the money landed: take the slot back if it is
    -- still free. The EXCLUDE guard is the arbiter.
    begin
      update public.bookings set status = 'confirmed', paid_cents = paid_cents + p_amount_cents
        where id = v_pay.booking_id returning id into v_id;
      return 'confirmed';
    exception when exclusion_violation then
      return 'slot_lost';
    end;
  else
    return 'slot_lost';
  end if;
end; $$;
revoke all on function public.apply_booking_payment(text, text, int) from public, anon, authenticated, service_role;
grant execute on function public.apply_booking_payment(text, text, int) to service_role;

-- ---------- mark_booking_paid: the admin's escape hatch for a transfer
-- received off-platform.
create function public.mark_booking_paid(p_booking_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_b record;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  select b.id, b.org_id, b.deposit_cents, b.currency into v_b
    from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs())
      and b.status = 'pending_payment' for update;
  if v_b.id is null then raise exception 'not found'; end if;
  insert into public.booking_payments (org_id, booking_id, kind, provider, amount_cents, currency, status, paid_at)
    values (v_b.org_id, v_b.id, 'deposit', 'manual', v_b.deposit_cents, coalesce(v_b.currency, 'PLN'), 'paid', now());
  update public.bookings set status = 'confirmed', paid_cents = paid_cents + v_b.deposit_cents where id = v_b.id;
  return v_b.id;
end; $$;
revoke all on function public.mark_booking_paid(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_booking_paid(uuid) to authenticated;

-- Rollback: drop trigger bookings_payments_carry + carry_booking_payments,
-- `create or replace` carry_booking_locale from 0072; drop mark_booking_paid,
-- apply_booking_payment, update_org_payments;
-- drop and recreate resolve_booking_token from 0078; `create or replace`
-- create_rental_booking_hours from 0078, create_rental_booking from 0062,
-- accept_booking from 0063, rotate_booking_token from 0064, cancel_booking
-- from 0070, the four free-check helpers from 0062; recreate policy
-- bookings_update_member from 0028 and both EXCLUDE guards from 0062;
--   alter table public.orgs drop column payment_hold_min, drop column legal;
--   drop table public.booking_payments; drop table public.payment_accounts;
--   alter table public.bookings drop column hold_expires_at, drop column paid_cents, drop column refunded_cents;
-- and restore 0062's bookings_status_check (any 'pending_payment'/'expired'
-- rows must be cancelled first).
```

- [ ] **Step 4: Register the migration, update Drizzle**

Append to `src/db/migrations/meta/_journal.json`:

```json
    {
      "idx": 79,
      "version": "7",
      "when": 1788800000000,
      "tag": "0079_holds_collection",
      "breakpoints": true
    }
```

Copy `meta/0078_snapshot.json` → `meta/0079_snapshot.json`; add `hold_expires_at` (timestamp with time zone, nullable), `paid_cents`, `refunded_cents` (integer, not null, default 0) under `public.bookings`; `payment_hold_min` (integer, not null, default 60) and `legal` (jsonb, not null, default `'{}'::jsonb`) under `public.orgs`; two new table entries `public.payment_accounts` and `public.booking_payments` in the shape of `public.calendar_connections` in the same file; bump `id`/`prevId` as the 0078 snapshot did relative to 0077.

`src/db/schema/scheduling.ts` after `people: integer("people"),`:

```ts
    // S2: the hold's deadline (set iff status = 'pending_payment', kept after
    // the flip), and what the client paid / got back — written only by the
    // payment RPCs and the refund path. Never TS-computed for display.
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    paidCents: integer("paid_cents").default(0).notNull(),
    refundedCents: integer("refunded_cents").default(0).notNull(),
```

`src/db/schema/orgs.ts` after `notificationPrefs`:

```ts
  // S2: how long a held booking waits for its deposit (30/60/180/1440 min)
  // and the legal identity the public footer prints. Written ONLY via
  // update_org_payments.
  paymentHoldMin: integer("payment_hold_min").default(60).notNull(),
  legal: jsonb("legal").default({}).notNull(),
```

Create `src/db/schema/payments.ts`:

```ts
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { bookings } from "./scheduling";

// S2: one Stripe connected account per org. Status is a cache of the last
// retrieve (features/payments/queries.ts refreshes it); 'active' is the only
// value the create RPCs read.
export const paymentAccounts = pgTable("payment_accounts", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  stripeAccountId: text("stripe_account_id").notNull().unique(),
  status: text("status").default("onboarding").notNull(),
  capabilities: jsonb("capabilities").default({}).notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// S2: the ledger of provider objects behind a booking's money — one row per
// Checkout session (S3 refunds and S7 charges append here).
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    stripeAccountId: text("stripe_account_id"),
    checkoutSessionId: text("checkout_session_id").unique(),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }),
    paymentIntentId: text("payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundId: text("refund_id"),
    refundedCents: integer("refunded_cents").default(0).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("booking_payments_booking_id_idx").on(t.bookingId, t.createdAt)],
);
```

Add `export * from "./payments";` to `src/db/schema/index.ts` after the `./scheduling` line.

- [ ] **Step 5: Apply and run the test**

Run: `npm run db:migrate && npm run test:integration -- src/features/payments/holds.integration.test.ts`
Expected: PASS (all cases). If the migration was edited after a first apply: `npm run db:reset` first.

Also run the neighbours that assert the old predicates: `npm run test:integration -- src/features/rentals/pricing-quote.integration.test.ts src/features/rentals/approval-rpc.integration.test.ts src/features/rentals/hourly-rpc.integration.test.ts src/features/rentals/h3-money-rpc.integration.test.ts`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0079_holds_collection.sql src/db/migrations/meta src/db/schema src/features/payments/holds.integration.test.ts
git commit -m "feat(db): S2 holds + collection — pending_payment, ledger, payment accounts, org hold/legal (0079)"
```

### Task 2: The payments provider seam — Stripe Connect + fake, env

**Files:**
- Create: `src/lib/payments/provider.ts`, `src/lib/payments/stripe.ts`, `src/lib/payments/fake.ts`
- Modify: `src/env-schema.ts` (four keys + refinements), `src/env.ts` (pass them through)
- Test: `src/lib/payments/provider.test.ts`, `src/lib/payments/fake.test.ts`, `src/lib/payments/stripe.test.ts`

**Interfaces:**
- Produces: `PaymentsProvider` (see below), `PaymentEvent`, `CheckoutInput`, `selectPaymentsProvider()`, `paymentsConfigured()`, `checkoutExpiresAt(holdExpiresAt: Date, now?: Date): number` (unix seconds), `signFakePaymentsWebhook(body, secret)`, `normalizeConnectEvent(event: Stripe.Event): PaymentEvent | null`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

`src/lib/payments/provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkoutExpiresAt } from "./provider";

describe("checkoutExpiresAt", () => {
  const now = new Date("2027-05-10T10:00:00Z");
  it("uses the hold when it is inside Stripe's window", () => {
    expect(checkoutExpiresAt(new Date("2027-05-10T11:00:00Z"), now)).toBe(Math.floor(new Date("2027-05-10T11:00:00Z").getTime() / 1000));
  });
  it("floors at now + 30 min 30 s", () => {
    expect(checkoutExpiresAt(new Date("2027-05-10T10:05:00Z"), now)).toBe(Math.floor(now.getTime() / 1000) + 30 * 60 + 30);
  });
  it("caps at now + 24 h", () => {
    expect(checkoutExpiresAt(new Date("2027-05-12T10:00:00Z"), now)).toBe(Math.floor(now.getTime() / 1000) + 24 * 3600);
  });
});
```

`src/lib/payments/fake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFakePaymentsWebhook, signFakePaymentsWebhook } from "./fake";

describe("fake payments webhook", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const body = JSON.stringify([{ type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_fake" }]);
  it("accepts a good signature and normalises", () => {
    const events = parseFakePaymentsWebhook(body, new Headers({ "x-signature": signFakePaymentsWebhook(body, secret) }), secret);
    expect(events).toEqual([{ type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_fake", eventId: expect.any(String) }]);
  });
  it("rejects a bad signature", () => {
    expect(() => parseFakePaymentsWebhook(body, new Headers({ "x-signature": "nope" }), secret)).toThrow(/signature/);
  });
});
```

`src/lib/payments/stripe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { normalizeConnectEvent } from "./stripe";

const session = (over: Record<string, unknown>) =>
  ({ id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 5000, payment_intent: "pi_1", ...over }) as unknown as Stripe.Checkout.Session;
const event = (type: string, obj: unknown, account = "acct_1") =>
  ({ id: "evt_1", type, account, data: { object: obj } }) as unknown as Stripe.Event;

describe("normalizeConnectEvent", () => {
  it("completed + paid", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({})))).toEqual({
      type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_1", eventId: "evt_1",
    });
  });
  it("completed + unpaid (P24 in flight)", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })))?.paid).toBe(false);
  });
  it("async succeeded / failed / expired map; others are null", () => {
    expect(normalizeConnectEvent(event("checkout.session.async_payment_succeeded", session({})))?.type).toBe("checkout.async_succeeded");
    expect(normalizeConnectEvent(event("checkout.session.async_payment_failed", session({})))?.type).toBe("checkout.async_failed");
    expect(normalizeConnectEvent(event("checkout.session.expired", session({})))?.type).toBe("checkout.expired");
    expect(normalizeConnectEvent(event("payment_intent.succeeded", {}))).toBeNull();
  });
  it("an expanded payment_intent object still yields its id", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({ payment_intent: { id: "pi_obj" } })))?.paymentIntentId).toBe("pi_obj");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/payments`
Expected: FAIL — modules not found.

- [ ] **Step 3: Env keys**

`src/env-schema.ts`, after the `BILLING_FOUNDER_CUTOFF` line:

```ts
  // S2 payments (Stripe Connect, the studio's own account). A SECOND Stripe
  // relationship: billing's keys sell Booklo's plan (Managed Payments);
  // these run direct charges on connected accounts. Unset = payments off.
  PAYMENTS_PROVIDER: z.enum(["fake", "stripe"]).optional(),
  PAYMENTS_FAKE_SECRET: z.string().min(16).optional(),
  STRIPE_CONNECT_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),
```

Inside the existing `superRefine`, after the `BILLING_FAKE_SECRET` production block (it runs only when `APP_ENV === "production"` — keep it there):

```ts
  if (value.PAYMENTS_FAKE_SECRET || value.PAYMENTS_PROVIDER === "fake") {
    ctx.addIssue({ code: "custom", path: ["PAYMENTS_PROVIDER"], message: "the fake payments provider must not run when APP_ENV=production" });
  }
```

And a provider-completeness check that runs in every environment — add it as a second `.superRefine` chained after the first (the first returns early outside production):

```ts
.superRefine((value, ctx) => {
  if (value.PAYMENTS_PROVIDER === "stripe") {
    for (const key of ["STRIPE_CONNECT_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"] as const) {
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when PAYMENTS_PROVIDER=stripe` });
    }
  }
  if (value.PAYMENTS_PROVIDER === "fake" && !value.PAYMENTS_FAKE_SECRET) {
    ctx.addIssue({ code: "custom", path: ["PAYMENTS_FAKE_SECRET"], message: "PAYMENTS_FAKE_SECRET is required when PAYMENTS_PROVIDER=fake" });
  }
})
```

`src/env.ts`: add the four `process.env.*` pass-throughs beside the billing ones. Add the four keys, commented, to `.env.example` (and `PAYMENTS_PROVIDER=fake` + a 32-char `PAYMENTS_FAKE_SECRET` to your own `.env.local`).

- [ ] **Step 4: `provider.ts`**

```ts
import { env } from "@/env";
import { stripePaymentsProvider } from "./stripe";
import { fakePaymentsProvider } from "./fake";

// S2: the vendor seam for client money (spec §Provider seam). Sibling of
// lib/billing/provider.ts, deliberately not the same interface — billing is
// subscription-shaped, this is "one deposit on the studio's own account".

export type AccountStatus = "onboarding" | "active" | "restricted";

export type CheckoutInput = {
  accountId: string;
  amountCents: number;
  currency: string;
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds, already clamped by checkoutExpiresAt. */
  expiresAt: number;
  locale: string | null;
  bookingId: string;
  paymentId: string;
};

export type PaymentEvent = {
  type: "checkout.completed" | "checkout.async_succeeded" | "checkout.async_failed" | "checkout.expired";
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number | null;
  /** completed only: false while an async method (P24) is still settling. */
  paid: boolean;
  accountId: string | null;
  eventId: string;
};

export interface PaymentsProvider {
  readonly name: "stripe" | "fake";
  createAccount(input: { country: string; email: string; displayName: string }): Promise<{ accountId: string }>;
  createOnboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  getAccountStatus(accountId: string): Promise<{ status: AccountStatus; capabilities: Record<string, string> }>;
  createCheckout(input: CheckoutInput): Promise<{ sessionId: string; url: string }>;
  /** Best effort; an already-expired/completed session is not an error. */
  expireCheckout(accountId: string, sessionId: string): Promise<void>;
  refund(accountId: string, paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ refundId: string }>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[];
}

export function paymentsConfigured(): boolean {
  if (env.PAYMENTS_PROVIDER === "stripe") return Boolean(env.STRIPE_CONNECT_SECRET_KEY && env.STRIPE_CONNECT_WEBHOOK_SECRET);
  if (env.PAYMENTS_PROVIDER === "fake") return Boolean(env.PAYMENTS_FAKE_SECRET);
  return false;
}

export function selectPaymentsProvider(): PaymentsProvider {
  if (env.PAYMENTS_PROVIDER === "stripe") return stripePaymentsProvider();
  if (env.PAYMENTS_PROVIDER === "fake") return fakePaymentsProvider();
  throw new Error("payments not configured");
}

const MIN_AHEAD_S = 30 * 60 + 30; // Stripe: expires_at ≥ 30 min after creation; +30 s of slack
const MAX_AHEAD_S = 24 * 3600;

/** Checkout expires when the hold does, inside Stripe's [30 min, 24 h] window. */
export function checkoutExpiresAt(holdExpiresAt: Date, now: Date = new Date()): number {
  const nowS = Math.floor(now.getTime() / 1000);
  const holdS = Math.floor(holdExpiresAt.getTime() / 1000);
  return Math.min(Math.max(holdS, nowS + MIN_AHEAD_S), nowS + MAX_AHEAD_S);
}
```

- [ ] **Step 5: `stripe.ts`**

```ts
import Stripe from "stripe";
import { env } from "@/env";
import type { AccountStatus, CheckoutInput, PaymentEvent, PaymentsProvider } from "./provider";

// Direct charges on Accounts v2 (spec rulings 1, 9; research §B):
// the studio is the merchant of record, pays Stripe's fees itself, Stripe
// carries losses; every money call carries { stripeAccount }.

const CHECKOUT_LOCALES = new Set(["pl", "en", "de", "cs", "sk", "lt", "lv", "et", "nl", "es", "it", "fr", "pt", "sv", "da", "fi", "nb"]);

export function normalizeConnectEvent(event: Stripe.Event): PaymentEvent | null {
  const map: Partial<Record<string, PaymentEvent["type"]>> = {
    "checkout.session.completed": "checkout.completed",
    "checkout.session.async_payment_succeeded": "checkout.async_succeeded",
    "checkout.session.async_payment_failed": "checkout.async_failed",
    "checkout.session.expired": "checkout.expired",
  };
  const type = map[event.type];
  if (!type) return null;
  const s = event.data.object as Stripe.Checkout.Session;
  const pi = s.payment_intent;
  return {
    type,
    sessionId: s.id,
    paymentIntentId: typeof pi === "string" ? pi : (pi?.id ?? null),
    amountCents: s.amount_total ?? null,
    paid: s.payment_status === "paid",
    accountId: event.account ?? null,
    eventId: event.id,
  };
}

function statusFrom(account: Stripe.V2.Core.Account): { status: AccountStatus; capabilities: Record<string, string> } {
  const caps = account.configuration?.merchant?.capabilities ?? {};
  const capabilities: Record<string, string> = {};
  for (const key of ["card_payments", "p24_payments", "blik_payments"] as const) {
    const c = (caps as Record<string, { status?: string } | undefined>)[key];
    if (c?.status) capabilities[key] = c.status;
  }
  const pastDue = account.requirements?.summary?.minimum_deadline?.status === "past_due";
  const cards = capabilities.card_payments;
  const status: AccountStatus = cards === "active" && !pastDue ? "active" : cards === "restricted" || pastDue ? "restricted" : "onboarding";
  return { status, capabilities };
}

export function stripePaymentsProvider(): PaymentsProvider {
  if (!env.STRIPE_CONNECT_SECRET_KEY) throw new Error("STRIPE_CONNECT_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_CONNECT_SECRET_KEY);
  return {
    name: "stripe",
    async createAccount(input) {
      const account = await stripe.v2.core.accounts.create({
        display_name: input.displayName,
        contact_email: input.email,
        dashboard: "full",
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        identity: { country: input.country.toLowerCase() },
        configuration: {
          merchant: {
            mcc: "7333", // D1 §4: commercial photography; never a rental MCC (6513 is prohibited for P24)
            capabilities: {
              card_payments: { requested: true },
              p24_payments: { requested: true },
              blik_payments: { requested: true },
            },
          },
        },
      });
      return { accountId: account.id };
    },
    async createOnboardingLink(accountId, returnUrl, refreshUrl) {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], return_url: returnUrl, refresh_url: refreshUrl } },
      });
      return link.url;
    },
    async getAccountStatus(accountId) {
      const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
      return statusFrom(account);
    },
    async createCheckout(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountCents, product_data: { name: input.productName } } }],
          customer_email: input.customerEmail,
          expires_at: input.expiresAt,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          locale: (input.locale && CHECKOUT_LOCALES.has(input.locale) ? input.locale : "auto") as Stripe.Checkout.SessionCreateParams.Locale,
          metadata: { booking_id: input.bookingId, payment_id: input.paymentId },
          payment_intent_data: { metadata: { booking_id: input.bookingId, payment_id: input.paymentId } },
          // No payment_method_types: the connected account's own dynamic
          // methods (P24 / BLIK / cards) apply.
        },
        { stripeAccount: input.accountId, idempotencyKey: input.paymentId },
      );
      if (!session.url) throw new Error("stripe: no checkout url");
      return { sessionId: session.id, url: session.url };
    },
    async expireCheckout(accountId, sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId });
      } catch (error) {
        // Already expired or completed: nothing to do. Anything else is logged, never thrown.
        console.warn("[payments] expireCheckout:", error instanceof Error ? error.message : error);
      }
    },
    async refund(accountId, paymentIntentId, amountCents, idempotencyKey) {
      const r = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents }, { stripeAccount: accountId, idempotencyKey });
      return { refundId: r.id };
    },
    parseWebhook(rawBody, headers) {
      if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET unset");
      const sig = headers.get("stripe-signature") ?? "";
      const event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_CONNECT_WEBHOOK_SECRET); // throws on bad signature
      const normalized = normalizeConnectEvent(event);
      return normalized ? [normalized] : [];
    },
  };
}
```

If `stripe.v2.core.accounts.create`'s `identity.country` or `configuration.merchant.mcc` do not typecheck, read `node_modules/stripe/esm/resources/V2/Core/Accounts.d.ts` (`interface AccountCreateParams`) and adjust the property path — the values above are from the 22.6.1 types (`country?: string`, `mcc?: string` under `Configuration.Merchant`).

- [ ] **Step 6: `fake.ts`**

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import type { PaymentEvent, PaymentsProvider } from "./provider";

// Mirrors lib/billing/fake.ts: HMAC over the body, events trusted verbatim.
// Dev/CI only — env-schema forbids it in production.

export function signFakePaymentsWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Body = JSON array of PaymentEvent minus `eventId` (one is minted here). */
export function parseFakePaymentsWebhook(rawBody: string, headers: Headers, secret: string): PaymentEvent[] {
  const provided = headers.get("x-signature") ?? "";
  const expected = signFakePaymentsWebhook(rawBody, secret);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
  const parsed = JSON.parse(rawBody) as Array<Omit<PaymentEvent, "eventId">>;
  return parsed.map((e) => ({ ...e, eventId: `evt_fake_${randomBytes(6).toString("hex")}` }));
}

export function fakePaymentsProvider(): PaymentsProvider {
  return {
    name: "fake",
    async createAccount(input) {
      return { accountId: `acct_fake_${input.country.toLowerCase()}_${randomBytes(6).toString("hex")}` };
    },
    // Instant onboarding: the link IS the return URL.
    async createOnboardingLink(_accountId, returnUrl) {
      return returnUrl;
    },
    async getAccountStatus() {
      return { status: "active", capabilities: { card_payments: "active", p24_payments: "active", blik_payments: "active" } };
    },
    async createCheckout(input) {
      const sessionId = `cs_fake_${randomBytes(8).toString("hex")}`;
      const q = new URLSearchParams({ session: sessionId, payment: input.paymentId, return: input.successUrl, cancel: input.cancelUrl });
      return { sessionId, url: `${env.NEXT_PUBLIC_APP_URL}/dev/payments/checkout?${q}` };
    },
    async expireCheckout() {},
    async refund() {
      return { refundId: `re_fake_${randomBytes(6).toString("hex")}` };
    },
    parseWebhook(rawBody, headers) {
      if (!env.PAYMENTS_FAKE_SECRET) throw new Error("PAYMENTS_FAKE_SECRET unset");
      return parseFakePaymentsWebhook(rawBody, headers, env.PAYMENTS_FAKE_SECRET);
    },
  };
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/lib/payments && npm run typecheck`
Expected: PASS; typecheck clean (fix any v2 param path per the note in Step 5).

- [ ] **Step 8: Commit**

```bash
git add src/lib/payments src/env-schema.ts src/env.ts .env.example
git commit -m "feat(payments): provider seam — Stripe Connect (Accounts v2, direct charges) + fake, env keys"
```

### Task 3: `moneyInfoLines` learns pay-now, paid, balance and refund

**Files:**
- Modify: `src/features/rentals/pricing.ts:61-75` (`moneyInfoLines`)
- Modify: `messages/en.json` (`public.units` +4 keys)
- Test: `src/features/rentals/pricing.test.ts` (`moneyInfoLines` block)

**Interfaces:**
- Produces: `moneyInfoLines(i: MoneyInfo, t: UnitsT): string[]` where `MoneyInfo = { totalCents, depositCents, currency, cancelWindowMin, lines?, paidCents?: number, refundedCents?: number, holding?: boolean }`. Existing callers (no new fields) produce exactly today's lines.

- [ ] **Step 1: Write the failing tests** — add to the `moneyInfoLines` describe in `pricing.test.ts`:

```ts
  it("a hold: deposit + pay-now, no venue note", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, holding: true }, t)).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Pay 60 zł now to confirm",
    ]));
  it("paid: paid line + balance at the venue", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 1440, paidCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
      "Free cancellation until 1 day before start",
    ]));
  it("paid in full: no balance line", () =>
    expect(moneyInfoLines({ totalCents: 6000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, paidCents: 6000 }, t)).toEqual([
      "Total: 60 zł",
      "Paid: 60 zł",
    ]));
  it("refunded: the refund line after the money", () =>
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 0, paidCents: 6000, refundedCents: 6000 }, t)).toEqual([
      "Total: 300 zł",
      "Paid: 60 zł",
      "240 zł due at the venue",
      "Refunded: 60 zł — bank refunds take up to 3 business days",
    ]));
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/rentals/pricing.test.ts`
Expected: FAIL (4 new cases).

- [ ] **Step 3: Implement**

Replace `moneyInfoLines` in `pricing.ts`:

```ts
export type MoneyInfo = {
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  cancelWindowMin: number;
  lines?: Line[] | null;
  /** S2: what the committed row says was paid / refunded (never computed here). */
  paidCents?: number;
  refundedCents?: number;
  /** S2: the booking is a hold awaiting its deposit. */
  holding?: boolean;
};

// Shared copy for the confirm step, the manage page and both emails. The
// quote's breakdown lines come first, one per line, and the total follows
// them (booking-money-summary.tsx relies on that order). S2 states: a hold
// says "pay now"; a paid booking says what was paid and what is left for the
// venue; a refund prints last, before the policy line.
export function moneyInfoLines(i: MoneyInfo, t: UnitsT): string[] {
  const lines: string[] = [];
  const paid = i.paidCents ?? 0;
  const refunded = i.refundedCents ?? 0;
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (i.currency && paid > 0) {
    lines.push(t("paid", { amount: formatMoney(paid, i.currency) }));
    if (i.totalCents !== null && i.totalCents > paid) lines.push(t("balanceAtVenue", { amount: formatMoney(i.totalCents - paid, i.currency) }));
  } else {
    if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
    if (i.holding && i.depositCents !== null && i.currency) lines.push(t("payNow", { amount: formatMoney(i.depositCents, i.currency) }));
    else if (lines.length > 0) lines.push(t("payAtVenue"));
  }
  if (i.currency && refunded > 0) lines.push(t("refund", { amount: formatMoney(refunded, i.currency) }));
  if (i.cancelWindowMin > 0) lines.push(t("freeCancellation", { window: formatCancelWindow(i.cancelWindowMin, t) }));
  return lines;
}
```

`messages/en.json` → `public.units`, after `"payAtVenue"`:

```json
    "payNow": "Pay {amount} now to confirm",
    "paid": "Paid: {amount}",
    "balanceAtVenue": "{amount} due at the venue",
    "refund": "Refunded: {amount} — bank refunds take up to 3 business days",
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/rentals/pricing.test.ts`
Expected: PASS (old and new). `src/i18n/messages.test.ts` will fail on uk/pl parity until Task 11 — expected; do not run the full suite yet.

- [ ] **Step 5: Commit**

```bash
git add src/features/rentals/pricing.ts src/features/rentals/pricing.test.ts messages/en.json
git commit -m "feat(rentals): moneyInfoLines — pay-now, paid, balance and refund lines (S2)"
```

### Task 4: The four client mails and their lifecycle keys

**Files:**
- Modify: `src/features/scheduling/templates.ts` (after `bookingDeclinedEmail`; the `bookingLifecycleKey` union at :223-248)
- Modify: `messages/en.json` (`emails.paymentDue`, `emails.paymentReceived`, `emails.holdExpired`, `emails.slotLost`)
- Test: `src/features/scheduling/templates.test.ts` (exists — add one describe; if it does not exist, create it with the same `emailTranslators("en")` preamble other template tests use: `grep -rn "emailTranslators(\"en\")" src --include=*.test.ts`)

**Interfaces:**
- Produces: `formatUntil(d: Date, timeZone: string, intlLocale: string): string`; `paymentDueEmail(t, { orgName, serviceName, whenLine, until, amount, payUrl, manageUrl, badgeUrl?, infoLines? })`, `paymentReceivedEmail(t, { orgName, serviceName, whenLine, badgeUrl?, infoLines? })`, `holdExpiredEmail(t, { orgName, serviceName, whenLine, bookAgainUrl, badgeUrl? })`, `slotLostEmail(t, { orgName, serviceName, whenLine, amount, badgeUrl? })` — each returns `{ subject, html, text }`; `bookingLifecycleKey` accepts `"payment-due" | "payment-received" | "hold-expired" | "slot-lost"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { emailTranslators } from "@/i18n/emails";
import { formatUntil, holdExpiredEmail, paymentDueEmail, paymentReceivedEmail, slotLostEmail, bookingLifecycleKey } from "./templates";

describe("S2 payment mails", () => {
  it("payment due carries the amount, the deadline, both links", async () => {
    const { t } = await emailTranslators("en");
    const m = paymentDueEmail(t, {
      orgName: "Studio X", serviceName: "Daylight room", whenLine: "Mon, 10 May 10:00–11:00", until: "Mon, 10 May 11:00",
      amount: "60 zł", payUrl: "https://app/booking/tok/pay", manageUrl: "https://app/booking/tok", infoLines: ["Total: 300 zł"],
    });
    expect(m.subject).toBe("Pay 60 zł by Mon, 10 May 11:00 to confirm — Daylight room, Mon, 10 May 10:00–11:00");
    expect(m.html).toContain('href="https://app/booking/tok/pay"');
    expect(m.text).toContain("https://app/booking/tok/pay");
    expect(m.text).toContain("https://app/booking/tok");
    expect(m.text).toContain("Total: 300 zł");
  });
  it("payment received has no manage link and says where the link is", async () => {
    const { t } = await emailTranslators("en");
    const m = paymentReceivedEmail(t, { orgName: "Studio X", serviceName: "Daylight room", whenLine: "Mon", infoLines: ["Paid: 60 zł"] });
    expect(m.subject).toBe("Payment received — Daylight room, Mon");
    expect(m.html).not.toContain("href=");
    expect(m.text).toContain("reservation email");
  });
  it("hold expired links to the booking page; slot lost names the refund", async () => {
    const { t } = await emailTranslators("en");
    expect(holdExpiredEmail(t, { orgName: "S", serviceName: "R", whenLine: "W", bookAgainUrl: "https://app/studio-x" }).html).toContain('href="https://app/studio-x"');
    expect(slotLostEmail(t, { orgName: "S", serviceName: "R", whenLine: "W", amount: "60 zł" }).text).toContain("60 zł");
  });
  it("formatUntil prints a zoned day + time", () => {
    expect(formatUntil(new Date("2027-05-10T09:32:00Z"), "Europe/Warsaw", "en-GB")).toBe("Mon 10 May, 11:32");
  });
  it("lifecycle keys", () => {
    expect(bookingLifecycleKey("b1", "payment-due")).toBe("booking/b1/payment-due");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/scheduling/templates.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — in `templates.ts`, extend the `kind` union of `bookingLifecycleKey` with:

```ts
    // S2 (0079): the hold's "pay by" mail, the webhook's confirmation, the
    // drain's release notice, the refund-after-the-fact notice.
    | "payment-due"
    | "payment-received"
    | "hold-expired"
    | "slot-lost"
```

and add after `bookingDeclinedEmail`:

```ts
/** "Mon 10 May, 11:32" in the org's zone — the hold deadline everywhere it prints. */
export function formatUntil(d: Date, timeZone: string, intlLocale: string): string {
  const day = new Intl.DateTimeFormat(intlLocale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat(intlLocale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}

const infoHtml = (lines?: string[]) => (lines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("");

export function paymentDueEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; until: string; amount: string;
  payUrl: string; manageUrl: string; badgeUrl?: string | null; infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("paymentDue.subject", { amount: input.amount, until: input.until, service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("paymentDue.lead", { until: input.until }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${infoHtml(input.infoLines)}
  <p style="margin: 16px 0 8px;">
    <a href="${esc(input.payUrl)}" style="display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">${esc(t("paymentDue.pay", { amount: input.amount }))}</a>
  </p>
  <p style="margin: 0 0 8px;"><a href="${esc(input.manageUrl)}">${esc(t("viewOrWithdraw"))}</a></p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("paymentDue.keep"))}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("paymentDue.lead", { until: input.until }), input.serviceName, input.whenLine,
    ...(input.infoLines ?? []), "", t("paymentDue.payText", { amount: input.amount, url: input.payUrl }),
    t("viewOrWithdrawText", { url: input.manageUrl }), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function paymentReceivedEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; badgeUrl?: string | null; infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("paymentReceived.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("paymentReceived.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${infoHtml(input.infoLines)}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("paymentReceived.manageHint"))}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("paymentReceived.lead"), input.serviceName, input.whenLine, ...(input.infoLines ?? []), "",
    t("paymentReceived.manageHint"), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function holdExpiredEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; bookAgainUrl: string; badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = t("holdExpired.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("holdExpired.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;"><a href="${esc(input.bookAgainUrl)}">${esc(t("holdExpired.bookAgain"))}</a></p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("holdExpired.lead"), input.serviceName, input.whenLine, "",
    t("holdExpired.bookAgainText", { url: input.bookAgainUrl }), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function slotLostEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; amount: string; badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = t("slotLost.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("slotLost.lead", { amount: input.amount }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [input.orgName, "", t("slotLost.lead", { amount: input.amount }), input.serviceName, input.whenLine, ...badgeTextLines(t, input.badgeUrl)].join("\n");
  return { subject, html, text };
}
```

`messages/en.json` → `emails`, after `"declined"`:

```json
    "paymentDue": {
      "subject": "Pay {amount} by {until} to confirm — {service}, {when}",
      "lead": "Your time is reserved until {until}. Pay the deposit to confirm it — unpaid reservations are released automatically.",
      "pay": "Pay {amount}",
      "payText": "Pay {amount}: {url}",
      "keep": "Keep this email — the links above are your access to the reservation."
    },
    "paymentReceived": {
      "subject": "Payment received — {service}, {when}",
      "lead": "Thank you — your payment was received and your booking is confirmed.",
      "manageHint": "To view or change it, use the link in your reservation email."
    },
    "holdExpired": {
      "subject": "Reservation released — {service}, {when}",
      "lead": "The deposit for this reservation was not received in time, so the time was released.",
      "bookAgain": "Book again",
      "bookAgainText": "Book again: {url}"
    },
    "slotLost": {
      "subject": "We couldn't confirm {service}, {when}",
      "lead": "Your payment arrived after the reservation had been released, and the time was taken meanwhile. {amount} is being refunded to you — bank refunds take up to 3 business days."
    },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/scheduling/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/templates.ts src/features/scheduling/templates.test.ts messages/en.json
git commit -m "feat(emails): payment due / received, hold expired, slot lost (S2)"
```

### Task 5: Create and accept actions send "pay by"; the widget shows the pay panel

**Files:**
- Modify: `src/features/rentals/hourly-actions.ts:162-375` (`createRentalBookingHours`)
- Modify: `src/features/rentals/public-actions.ts:125-344` (`createRentalBooking`, nights/days)
- Modify: `src/features/scheduling/booking-actions.ts:588-745` (`acceptBookingRequest`)
- Modify: `src/features/scheduling/components/booking-confirmed.tsx`, `src/features/rentals/components/hourly-booking-flow.tsx:96-99,215-235,293-307`, `src/features/rentals/components/rental-booking-flow.tsx:130-175`
- Modify: `messages/en.json` (`public.confirmed` +4 keys)
- Test: `src/features/rentals/hourly-flow.integration.test.ts` (extend — it already drives `createRentalBookingHours` end to end with a stubbed transport; add one case)

**Interfaces:**
- Consumes: Task 1 columns (`hold_expires_at`, `deposit_cents`), Task 3 `moneyInfoLines({ holding })`, Task 4 `paymentDueEmail`, `formatUntil`, `bookingLifecycleKey("payment-due")`.
- Produces: both create actions return `{ ok: true; token: string; pending: boolean; payment?: { until: string; amount: string } }`; `BookingConfirmed` takes `payment?: { until: string; amount: string } | null`; the pay URL is `${manageUrl}/pay` (Task 6 builds the route).

- [ ] **Step 1: Write the failing test** — open `src/features/rentals/hourly-flow.integration.test.ts`, find how it seeds an org + hourly offering and how it stubs `selectTransport` (it mocks `@/lib/email/transport`). Add, using the same helpers:

```ts
  it("a deposit on an org with an active payment account → payment outcome, pay-by mail, no provider notice", async () => {
    // seed as the file's other cases do, then:
    await admin.from("rental_offerings").update({ price_cents: 10000, pricing_mode: "per_unit", deposit_type: "percent", deposit_value: 50 }).eq("id", offeringId);
    await admin.from("payment_accounts").insert({ org_id: orgId, stripe_account_id: `acct_flow_${orgId.slice(0, 8)}`, status: "active" });
    sent.length = 0; // the transport stub's captured sends, whatever the file names it
    const result = await createRentalBookingHours({ /* same shape as the file's happy case */ });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pending).toBe(false);
    expect(result.payment?.amount).toBe("50 zł");
    expect(result.payment?.until).toMatch(/\d{2}:\d{2}$/);
    const clientMail = sent.find((m) => m.subject.startsWith("Pay 50 zł by"));
    expect(clientMail?.text).toContain(`/booking/${result.token}/pay`);
    expect(clientMail?.text).toContain("Pay 50 zł now to confirm");
    // no provider "new booking" notice for a hold
    expect(sent.some((m) => /new booking/i.test(m.subject))).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/features/rentals/hourly-flow.integration.test.ts`
Expected: FAIL — `payment` undefined, no "Pay 50 zł by" mail.

- [ ] **Step 3: `createRentalBookingHours`**

Imports: add `paymentDueEmail`, `formatUntil` to the `@/features/scheduling/templates` import; `import { formatMoney } from "@/lib/money";`.

Return type: `{ ok: true; token: string; pending: boolean; payment?: { until: string; amount: string } }`.

Status read (`:259-263`) → select `"status, hold_expires_at, lines, people, price_cents, deposit_cents"` and after `isPending`:

```ts
    // S2: the RPC held the row for its deposit (0079) — the client gets the
    // "pay by" mail instead of a confirmation, and the provider hears
    // nothing until the payment lands (the webhook's newBooking).
    const isHeld = statusRow?.status === "pending_payment";
    const holdUntil = isHeld && statusRow?.hold_expires_at ? new Date(statusRow.hold_expires_at) : null;
```

In `money` (`:285-301`) add `holding: isHeld,`. In the mail-prep `prep` object add `clientUntil: string | null` = `holdUntil ? formatUntil(holdUntil, tz, client.intlLocale) : null`, and `amount: string | null` = `statusRow?.deposit_cents != null ? formatMoney(statusRow.deposit_cents, ctx.org.currency) : null`. Both early `return { ok: true, token, pending: isPending }` lines become `return { ok: true, token, pending: isPending, payment: isHeld && clientUntil && amount ? { until: clientUntil, amount } : undefined }` (compute `payment` once, right after `prep`, and reuse it in every success return).

The client mail (`:318-350`): a third branch first —

```ts
      const msg = isHeld && clientUntil && amount
        ? paymentDueEmail(client.t, {
            orgName: ctx.org.orgName,
            serviceName,
            whenLine: clientWhenLine,
            until: clientUntil,
            amount,
            payUrl: `${manageUrl}/pay`,
            manageUrl,
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
            infoLines: clientInfoLines,
          })
        : isPending
          ? bookingRequestReceivedEmail(/* unchanged */)
          : bookingConfirmationEmail(/* unchanged */);
```

with `idempotencyKey: isHeld ? bookingLifecycleKey(bookingId as string, "payment-due") : bookingIdempotencyKey(bookingId as string)`.

The provider notice (`:358-368`): wrap in `if (!isHeld) { await notifyMembers({...}); }`.

- [ ] **Step 4: `createRentalBooking` (nights/days)** — the same four edits: select `"status, hold_expires_at, deposit_cents"` at `:243-246`; `isHeld`/`holdUntil`; `holding: isHeld` on `money` (`:281-286`); `clientUntil` (`formatUntil(holdUntil, tz, client.intlLocale)`) and `amount` (`formatMoney(statusRow.deposit_cents, org.currency)`) in `prep`; the `paymentDueEmail` branch with `payUrl: \`${manageUrl}/pay\``; `if (!isHeld)` around `notifyMembers`; every success return carries `payment`.

- [ ] **Step 5: `acceptBookingRequest`** — the re-read select (`:614-617`) gains `hold_expires_at, deposit_cents, lines` (and the row type `hold_expires_at: string | null; lines: unknown`). After `const row = …`:

```ts
        // S2 (0079): the RPC may have HELD the row instead of confirming it —
        // the client then gets "pay by", not the confirmation.
        const held = row?.status === "pending_payment" && row.hold_expires_at;
```

(add `status: string` to the select and row type). Inside the `else` branch after the rotate succeeds, replace `const msg = bookingConfirmationEmail(...)` with:

```ts
              const money = row.rental_unit_id !== null ? {
                totalCents: row.price_cents, depositCents: row.deposit_cents, currency: row.currency,
                cancelWindowMin: row.rental_offerings?.cancel_window_min ?? 0,
                lines: (row.lines as Line[] | null) ?? null, holding: Boolean(held),
              } : null;
              const infoLines = money ? moneyInfoLines(money, forClient.tUnits) : [];
              const msg = held && row.deposit_cents != null && row.currency
                ? paymentDueEmail(forClient.t, {
                    orgName: org.name,
                    serviceName: forClient.serviceName,
                    whenLine: forClient.whenLine,
                    until: formatUntil(new Date(row.hold_expires_at!), org.timezone, forClient.intlLocale),
                    amount: formatMoney(row.deposit_cents, row.currency),
                    payUrl: `${buildBookingManageUrl(fresh.token)}/pay`,
                    manageUrl: buildBookingManageUrl(fresh.token),
                    badgeUrl: await emailBadgeUrl(org.id),
                    infoLines,
                  })
                : bookingConfirmationEmail(forClient.t, { /* unchanged */ infoLines });
```

Imports: `paymentDueEmail`, `formatUntil` from templates; `formatMoney` from `@/lib/money`; `type Line` from `@/features/rentals/pricing-rules`. Check `forClient` exposes `intlLocale` (read `clientMailCopy` in the same file; add it to its return if missing). The idempotency key stays `manage-accept` (one mail per accept, whichever it is).

- [ ] **Step 6: The panel** — `booking-confirmed.tsx`:

```tsx
export function BookingConfirmed({ token, summary, staffName, pending, payment }: {
  token: string;
  summary?: { title: string; whenLine: string };
  staffName?: string | null;
  pending?: boolean;
  /** S2: a HOLD — reserved until `until`, `amount` to pay to confirm. */
  payment?: { until: string; amount: string } | null;
}) {
  const t = useTranslations("public.confirmed");
  const locale = useLocale();
  const heading = payment ? t("reservedUntil", { until: payment.until }) : pending ? t("requestSent") : t("bookingConfirmed");
  const body = payment ? t("payBody", { amount: payment.amount }) : pending ? t("pendingBody") : t("confirmedBody");
  return (
    <div className="wt-enter flex flex-col gap-4 py-2">
      <div className="flex items-start gap-3">
        {/* icon disc unchanged */}
        <div className="min-w-0 pt-1">
          <h2 className="text-[17px] leading-tight font-medium">{heading}</h2>
          {/* summary + staffName unchanged */}
          <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{body}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-12">
        {/* New tab, as below: Checkout refuses to render inside an iframe. */}
        {payment ? (
          <a className={cn(buttonVariants({ variant: "brand" }), CHIP, "h-9 px-3.5")} href={withLang(`/booking/${token}/pay`, locale)} target="_blank" rel="noopener">
            {t("pay", { amount: payment.amount })}
          </a>
        ) : null}
        <a className={cn(buttonVariants({ variant: "outline" }), CHIP, "h-9 px-3.5")} href={withLang(`/booking/${token}`, locale)} target="_blank" rel="noopener">
          {payment ? t("viewReservation") : pending ? t("viewRequest") : t("viewBooking")}
        </a>
        {pending || payment ? null : (
          <a /* .ics link unchanged */ />
        )}
      </div>
    </div>
  );
}
```

`hourly-booking-flow.tsx`: `const [donePayment, setDonePayment] = React.useState<{ until: string; amount: string } | null>(null);` set from `result.payment ?? null` beside `setDonePending`, and `<BookingConfirmed token={doneToken} summary={summary} pending={donePending} payment={donePayment} />`. Same three lines in `rental-booking-flow.tsx`.

`messages/en.json` → `public.confirmed`:

```json
    "reservedUntil": "Reserved until {until}",
    "payBody": "Pay {amount} to confirm. Unpaid reservations are released automatically.",
    "pay": "Pay {amount}",
    "viewReservation": "View reservation",
```

- [ ] **Step 7: Run**

Run: `npm run test:integration -- src/features/rentals/hourly-flow.integration.test.ts src/features/rentals/flow.integration.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/features/rentals src/features/scheduling messages/en.json
git commit -m "feat(rentals): held bookings — pay-by mail from create/accept, pay panel in the widget (S2)"
```

### Task 6: Pay route, webhook, `applyPaymentEvents`, confirmation side-effects, dev checkout

**Files:**
- Modify: `src/lib/tokens/booking.ts:50-120` (resolver mapping: `holdExpiresAt`, `paidCents`, `refundedCents`)
- Create: `src/features/payments/checkout.ts`, `src/features/payments/confirm-effects.ts`, `src/features/payments/apply.ts`
- Create: `src/app/booking/[token]/pay/route.ts`, `src/app/api/payments/webhook/route.ts`
- Create: `src/app/dev/payments/checkout/page.tsx`, `src/app/dev/payments/actions.ts`
- Test: `src/app/api/payments/webhook/route.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC `apply_booking_payment`, tables; Task 2 `selectPaymentsProvider`, `paymentsConfigured`, `checkoutExpiresAt`, `PaymentEvent`, `signFakePaymentsWebhook`; Task 3 `moneyInfoLines({ paidCents })`; Task 4 `paymentReceivedEmail`, `slotLostEmail`, `bookingLifecycleKey`.
- Produces: `startCheckout(bookingId, { successUrl, cancelUrl, locale }, deps?) → { url } | { error }`; `applyPaymentEvents(events, deps) → { processed, outcomes: string[] }`; `sendPaymentReceived(bookingId, deps?) → Promise<void>` (also used by Task 9's Mark-as-paid); `resolveBookingToken(...).booking.{holdExpiresAt: Date | null, paidCents: number, refundedCents: number}`.

- [ ] **Step 1: Write the failing test** — `src/app/api/payments/webhook/route.integration.test.ts` (env + import order copied from `src/app/api/billing/webhook/route.integration.test.ts:1-14`; the org/offering/hold seeding from Task 1's `holds.integration.test.ts` — `newOrg`, `hoursFixture` with the H3 deposit overrides, `activeAccount`, `createHours`):

```ts
process.env.PAYMENTS_PROVIDER = "fake";
process.env.PAYMENTS_FAKE_SECRET = "test-secret-0123456789abcdef";
const { POST } = await import("./route");
const { signFakePaymentsWebhook } = await import("@/lib/payments/fake");
// … admin/anon clients + helpers …

function post(events: unknown[]) {
  const body = JSON.stringify(events);
  return POST(new Request("http://localhost/api/payments/webhook", {
    method: "POST", body, headers: { "x-signature": signFakePaymentsWebhook(body, process.env.PAYMENTS_FAKE_SECRET!) },
  }));
}
async function ledger(bookingId: string, sessionId: string) {
  const { data: b } = await admin.from("bookings").select("org_id").eq("id", bookingId).single();
  const { data } = await admin.from("booking_payments").insert({
    org_id: b!.org_id, booking_id: bookingId, kind: "deposit", provider: "fake", amount_cents: 5000, currency: "PLN",
    status: "pending", checkout_session_id: sessionId, stripe_account_id: "acct_fake_x",
  }).select("id").single();
  return data!.id as string;
}

describe("POST /api/payments/webhook (fake provider)", () => {
  it("rejects a bad signature", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "[]", headers: { "x-signature": "nope" } }));
    expect(res.status).toBe(401);
  });
  it("completed+paid confirms the hold and reports it", async () => {
    const { client, orgId, handle } = await newOrg("wh");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id!, "cs_wh_" + id);
    const res = await post([{ type: "checkout.completed", sessionId: "cs_wh_" + id, paymentIntentId: "pi_wh", amountCents: 5000, paid: true, accountId: "acct_fake_x" }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, outcomes: ["confirmed"] });
    const { data: b } = await admin.from("bookings").select("status, paid_cents").eq("id", id!).single();
    expect(b).toEqual({ status: "confirmed", paid_cents: 5000 });
  });
  it("completed+unpaid marks processing and extends the hold by an hour", async () => {
    const { client, orgId, handle } = await newOrg("async");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id!, "cs_as_" + id);
    const before = (await admin.from("bookings").select("hold_expires_at").eq("id", id!).single()).data!.hold_expires_at as string;
    await post([{ type: "checkout.completed", sessionId: "cs_as_" + id, paymentIntentId: "pi_as", amountCents: 5000, paid: false, accountId: "acct_fake_x" }]);
    const after = (await admin.from("bookings").select("status, hold_expires_at").eq("id", id!).single()).data!;
    expect(after.status).toBe("pending_payment");
    expect(new Date(after.hold_expires_at as string).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect((await admin.from("booking_payments").select("status").eq("checkout_session_id", "cs_as_" + id).single()).data!.status).toBe("processing");
    await post([{ type: "checkout.async_succeeded", sessionId: "cs_as_" + id, paymentIntentId: "pi_as", amountCents: 5000, paid: true, accountId: "acct_fake_x" }]);
    expect((await admin.from("bookings").select("status").eq("id", id!).single()).data!.status).toBe("confirmed");
  });
  it("async_failed / expired only touch the ledger; unknown session is a 200 no-op", async () => {
    const { client, orgId, handle } = await newOrg("fail");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id!, "cs_f_" + id);
    await post([{ type: "checkout.async_failed", sessionId: "cs_f_" + id, paymentIntentId: null, amountCents: null, paid: false, accountId: "acct_fake_x" }]);
    expect((await admin.from("booking_payments").select("status").eq("checkout_session_id", "cs_f_" + id).single()).data!.status).toBe("failed");
    expect((await admin.from("bookings").select("status").eq("id", id!).single()).data!.status).toBe("pending_payment");
    const res = await post([{ type: "checkout.expired", sessionId: "cs_none", paymentIntentId: null, amountCents: null, paid: false, accountId: null }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcomes: ["unknown"] });
  });
  it("slot_lost refunds and marks the ledger refunded", async () => {
    const { client, orgId, handle } = await newOrg("lostwh");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("bookings").update({ status: "expired" }).eq("id", id!);
    await createHours(handle, offeringId, 10); // someone else took it
    await ledger(id!, "cs_l_" + id);
    const res = await post([{ type: "checkout.completed", sessionId: "cs_l_" + id, paymentIntentId: "pi_l", amountCents: 5000, paid: true, accountId: "acct_fake_x" }]);
    expect(await res.json()).toMatchObject({ outcomes: ["slot_lost"] });
    const { data: row } = await admin.from("booking_payments").select("status, refunded_cents, refund_id").eq("checkout_session_id", "cs_l_" + id).single();
    expect(row).toMatchObject({ status: "refunded", refunded_cents: 5000 });
    expect(row!.refund_id).toMatch(/^re_fake_/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/app/api/payments/webhook/route.integration.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Resolver mapping** — `src/lib/tokens/booking.ts`: add to the row type `hold_expires_at: string | null; paid_cents: number; refunded_cents: number;` and to the returned booking `holdExpiresAt: row.hold_expires_at ? new Date(row.hold_expires_at) : null, paidCents: row.paid_cents ?? 0, refundedCents: row.refunded_cents ?? 0,` (and the same three on the `ResolveBookingResult` booking type above it).

- [ ] **Step 4: `confirm-effects.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport, type EmailTransport } from "@/lib/email/transport";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { notifyMembers } from "@/features/notifications/notify";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { withUnit } from "@/features/rentals/unit-label";
import { moneyInfoLines } from "@/features/rentals/pricing";
import type { Line } from "@/features/rentals/pricing-rules";
import { bookingLifecycleKey, paymentReceivedEmail, whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

const COLS =
  "id, org_id, client_name, client_email, starts_at, ends_at, rental_unit_id, locale, note, price_cents, currency, deposit_cents, paid_cents, refunded_cents, lines, rental_offerings(name, range_mode, cancel_window_min), rental_units(name), orgs(name, timezone, locale)";

type Row = {
  id: string; org_id: string; client_name: string; client_email: string | null; starts_at: string; ends_at: string;
  rental_unit_id: string | null; locale: string | null; note: string | null; price_cents: number | null; currency: string | null;
  deposit_cents: number | null; paid_cents: number; refunded_cents: number; lines: unknown;
  rental_offerings: { name: string; range_mode: RangeMode; cancel_window_min: number } | null;
  rental_units: { name: string } | null; orgs: { name: string; timezone: string; locale: string } | null;
};

/** Everything a confirmation-by-payment triggers (spec §Flows, "one helper"):
    the client's payment-received mail (no manage link — the raw token is
    never stored), the provider's newBooking notice, the Google mirror.
    Best effort: logs, never throws. */
export async function sendPaymentReceived(bookingId: string, deps: { db?: SupabaseClient; transport?: EmailTransport } = {}): Promise<void> {
  const db = deps.db ?? createAdminClient();
  try {
    const { data, error } = await db.from("bookings").select(COLS).eq("id", bookingId).maybeSingle();
    if (error || !data) { console.error("[payments] sendPaymentReceived read:", error); return; }
    const row = data as unknown as Row;
    const org = row.orgs!;
    const serviceName = withUnit(row.rental_offerings?.name ?? "", row.rental_units?.name ?? null);
    const client = await emailTranslators(row.locale ?? org.locale);
    const mail = await emailTranslators(org.locale);
    const b = { startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), isRental: row.rental_unit_id !== null, rangeMode: row.rental_offerings?.range_mode ?? null };
    const money = {
      totalCents: row.price_cents, depositCents: row.deposit_cents, currency: row.currency,
      cancelWindowMin: row.rental_offerings?.cancel_window_min ?? 0, lines: (row.lines as Line[] | null) ?? null,
      paidCents: row.paid_cents, refundedCents: row.refunded_cents,
    };
    kickCalendarSync(row.org_id);
    if (row.client_email) {
      try {
        const msg = paymentReceivedEmail(client.t, {
          orgName: org.name, serviceName, whenLine: whenLineFor(b, org.timezone, client.intlLocale),
          badgeUrl: await emailBadgeUrl(row.org_id), infoLines: moneyInfoLines(money, client.tUnits),
        });
        await (deps.transport ?? selectTransport()).send({
          to: row.client_email, subject: msg.subject, html: msg.html, text: msg.text,
          idempotencyKey: bookingLifecycleKey(row.id, "payment-received"),
        });
      } catch (e) { console.error("[payments] payment-received mail failed:", e); }
    }
    await notifyMembers({
      orgId: row.org_id, event: "newBooking", serviceName, clientName: row.client_name, clientEmail: row.client_email ?? "",
      whenLine: whenLineFor(b, org.timezone, mail.intlLocale), note: row.note, infoLines: moneyInfoLines(money, mail.tUnits),
      idempotencyKey: bookingLifecycleKey(row.id, "provider-new"),
    }, { db, transport: deps.transport });
  } catch (e) { console.error("[payments] sendPaymentReceived:", e); }
}
```

- [ ] **Step 5: `checkout.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutExpiresAt, selectPaymentsProvider, type PaymentsProvider } from "@/lib/payments/provider";
import { withUnit } from "@/features/rentals/unit-label";
import { whenLineFor } from "@/features/scheduling/templates";
import { INTL_LOCALES, isLocale, DEFAULT_LOCALE } from "@/i18n/config";
import type { RangeMode } from "@/features/rentals/range";

export type StartCheckoutResult = { url: string } | { error: "not_held" | "expired" | "no_account" | "provider" };

/** Create-or-reuse the Checkout session for a held booking (spec ruling 8).
    Reuses the newest open ledger row; otherwise inserts one (its id is the
    provider idempotency key), asks the provider, and stores the session. */
export async function startCheckout(
  bookingId: string,
  opts: { successUrl: string; cancelUrl: string; locale: string | null },
  deps: { db?: SupabaseClient; provider?: PaymentsProvider; now?: Date } = {},
): Promise<StartCheckoutResult> {
  const db = deps.db ?? createAdminClient();
  const now = deps.now ?? new Date();
  const { data: b, error } = await db.from("bookings")
    .select("id, org_id, status, hold_expires_at, deposit_cents, currency, client_email, starts_at, ends_at, rental_unit_id, rental_offerings(name, range_mode), rental_units(name), orgs(timezone)")
    .eq("id", bookingId).maybeSingle();
  if (error || !b) return { error: "not_held" };
  const row = b as unknown as { id: string; org_id: string; status: string; hold_expires_at: string | null; deposit_cents: number | null; currency: string | null; client_email: string; starts_at: string; ends_at: string; rental_unit_id: string | null; rental_offerings: { name: string; range_mode: RangeMode } | null; rental_units: { name: string } | null; orgs: { timezone: string } | null };
  if (row.status !== "pending_payment" || !row.hold_expires_at || !row.deposit_cents || !row.currency) return { error: "not_held" };
  const hold = new Date(row.hold_expires_at);
  if (hold.getTime() <= now.getTime()) return { error: "expired" };
  const { data: acct } = await db.from("payment_accounts").select("stripe_account_id").eq("org_id", row.org_id).eq("status", "active").maybeSingle();
  if (!acct) return { error: "no_account" };

  const { data: open } = await db.from("booking_payments").select("checkout_url")
    .eq("booking_id", row.id).eq("status", "pending").not("checkout_url", "is", null)
    .gt("checkout_expires_at", new Date(now.getTime() + 60_000).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (open?.checkout_url) return { url: open.checkout_url };

  const provider = deps.provider ?? selectPaymentsProvider();
  const { data: inserted, error: insErr } = await db.from("booking_payments").insert({
    org_id: row.org_id, booking_id: row.id, kind: "deposit", provider: provider.name,
    amount_cents: row.deposit_cents, currency: row.currency, status: "pending", stripe_account_id: acct.stripe_account_id,
  }).select("id").single();
  if (insErr || !inserted) { console.error("[payments] ledger insert:", insErr); return { error: "provider" }; }
  const paymentId = inserted.id as string;
  const locale = opts.locale && isLocale(opts.locale) ? opts.locale : DEFAULT_LOCALE;
  const when = whenLineFor({ startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), isRental: true, rangeMode: row.rental_offerings?.range_mode ?? null }, row.orgs?.timezone ?? "UTC", INTL_LOCALES[locale]);
  const expiresAt = checkoutExpiresAt(hold, now);
  try {
    const { sessionId, url } = await provider.createCheckout({
      accountId: acct.stripe_account_id, amountCents: row.deposit_cents, currency: row.currency,
      productName: `${withUnit(row.rental_offerings?.name ?? "", row.rental_units?.name ?? null)} — ${when}`,
      customerEmail: row.client_email, successUrl: opts.successUrl, cancelUrl: opts.cancelUrl, expiresAt, locale,
      bookingId: row.id, paymentId,
    });
    await db.from("booking_payments").update({ checkout_session_id: sessionId, checkout_url: url, checkout_expires_at: new Date(expiresAt * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", paymentId);
    return { url };
  } catch (e) {
    console.error("[payments] createCheckout:", e);
    await db.from("booking_payments").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "checkout failed", updated_at: new Date().toISOString() }).eq("id", paymentId);
    return { error: "provider" };
  }
}
```

(`isLocale`, `DEFAULT_LOCALE`, `INTL_LOCALES` — confirm their export names in `src/i18n/config.ts`.)

- [ ] **Step 6: `apply.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import type { PaymentEvent, PaymentsProvider } from "@/lib/payments/provider";
import { sendPaymentReceived } from "./confirm-effects";
import { sendSlotLost } from "./refund";

export type ApplySummary = { processed: number; outcomes: string[] };

const ASYNC_GRACE_MS = 60 * 60_000; // P24 settles or fails within the hour (research §B2)

export async function applyPaymentEvents(
  events: PaymentEvent[],
  deps: { db: SupabaseClient; provider: PaymentsProvider; transport?: EmailTransport },
): Promise<ApplySummary> {
  const outcomes: string[] = [];
  for (const e of events) {
    const { data: ledger } = await deps.db.from("booking_payments")
      .select("id, booking_id, org_id, status, amount_cents, stripe_account_id").eq("checkout_session_id", e.sessionId).maybeSingle();
    if (!ledger) { outcomes.push("unknown"); continue; }
    const stamp = { updated_at: new Date().toISOString() };
    if ((e.type === "checkout.completed" && e.paid) || e.type === "checkout.async_succeeded") {
      const { data: result, error } = await deps.db.rpc("apply_booking_payment", {
        p_session_id: e.sessionId, p_payment_intent_id: e.paymentIntentId ?? "", p_amount_cents: e.amountCents ?? ledger.amount_cents,
      });
      if (error) throw error; // 500 → the provider retries
      outcomes.push(result as string);
      if (result === "confirmed") await sendPaymentReceived(ledger.booking_id, { db: deps.db, transport: deps.transport });
      if (result === "slot_lost") await sendSlotLost(ledger.id, { db: deps.db, provider: deps.provider, transport: deps.transport });
    } else if (e.type === "checkout.completed") {
      // Async method in flight: keep the hold alive for the settlement window.
      await deps.db.from("booking_payments").update({ status: "processing", payment_intent_id: e.paymentIntentId, ...stamp }).eq("id", ledger.id).in("status", ["pending", "processing"]);
      const { data: b } = await deps.db.from("bookings").select("hold_expires_at, status").eq("id", ledger.booking_id).single();
      if (b?.status === "pending_payment") {
        const floor = Date.now() + ASYNC_GRACE_MS;
        const current = b.hold_expires_at ? new Date(b.hold_expires_at as string).getTime() : 0;
        if (current < floor) await deps.db.from("bookings").update({ hold_expires_at: new Date(floor).toISOString() }).eq("id", ledger.booking_id).eq("status", "pending_payment");
      }
      outcomes.push("processing");
    } else if (e.type === "checkout.async_failed") {
      await deps.db.from("booking_payments").update({ status: "failed", ...stamp }).eq("id", ledger.id).in("status", ["pending", "processing"]);
      outcomes.push("failed");
    } else {
      await deps.db.from("booking_payments").update({ status: "expired", ...stamp }).eq("id", ledger.id).in("status", ["pending", "processing"]);
      outcomes.push("expired");
    }
  }
  return { processed: events.length, outcomes };
}
```

`sendSlotLost` lives in Task 7's `refund.ts`; create that file now with just this function (Task 7 adds `refundBooking` beside it):

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport, type EmailTransport } from "@/lib/email/transport";
import { selectPaymentsProvider, type PaymentsProvider } from "@/lib/payments/provider";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/money";
import { withUnit } from "@/features/rentals/unit-label";
import { bookingLifecycleKey, slotLostEmail, whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

type Deps = { db?: SupabaseClient; provider?: PaymentsProvider; transport?: EmailTransport };

/** Refund one PAID ledger row in full; records the outcome on the row.
    Returns false when the provider refused (row → refund_failed + error). */
export async function refundLedgerRow(ledgerId: string, reason: string, deps: Deps = {}): Promise<boolean> {
  const db = deps.db ?? createAdminClient();
  const provider = deps.provider ?? selectPaymentsProvider();
  const { data: row } = await db.from("booking_payments").select("id, booking_id, status, amount_cents, refunded_cents, payment_intent_id, stripe_account_id").eq("id", ledgerId).maybeSingle();
  if (!row || row.status !== "paid" || !row.payment_intent_id || !row.stripe_account_id) return false;
  const amount = row.amount_cents - row.refunded_cents;
  if (amount <= 0) return true;
  try {
    const { refundId } = await provider.refund(row.stripe_account_id, row.payment_intent_id, amount, `${row.id}:${reason}`);
    await db.from("booking_payments").update({ status: "refunded", refund_id: refundId, refunded_cents: row.refunded_cents + amount, updated_at: new Date().toISOString() }).eq("id", row.id);
    await db.rpc("bump_booking_refunded", { p_booking_id: row.booking_id, p_cents: amount });
    return true;
  } catch (e) {
    console.error("[payments] refund failed:", e);
    await db.from("booking_payments").update({ status: "refund_failed", error: e instanceof Error ? e.message.slice(0, 500) : "refund failed", updated_at: new Date().toISOString() }).eq("id", row.id);
    return false;
  }
}

/** A payment landed on a booking whose slot is gone: refund + tell the client. */
export async function sendSlotLost(ledgerId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? createAdminClient();
  await refundLedgerRow(ledgerId, "slot-lost", deps);
  const { data } = await db.from("booking_payments")
    .select("amount_cents, currency, bookings(id, client_email, locale, starts_at, ends_at, rental_unit_id, org_id, rental_offerings(name, range_mode), rental_units(name), orgs(name, timezone, locale))")
    .eq("id", ledgerId).maybeSingle();
  const b = (data as unknown as { amount_cents: number; currency: string; bookings: { id: string; client_email: string | null; locale: string | null; starts_at: string; ends_at: string; rental_unit_id: string | null; org_id: string; rental_offerings: { name: string; range_mode: RangeMode } | null; rental_units: { name: string } | null; orgs: { name: string; timezone: string; locale: string } } } | null)?.bookings;
  if (!b?.client_email || !data) return;
  try {
    const client = await emailTranslators(b.locale ?? b.orgs.locale);
    const msg = slotLostEmail(client.t, {
      orgName: b.orgs.name, serviceName: withUnit(b.rental_offerings?.name ?? "", b.rental_units?.name ?? null),
      whenLine: whenLineFor({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), isRental: true, rangeMode: b.rental_offerings?.range_mode ?? null }, b.orgs.timezone, client.intlLocale),
      amount: formatMoney(data.amount_cents, data.currency), badgeUrl: await emailBadgeUrl(b.org_id),
    });
    await (deps.transport ?? selectTransport()).send({ to: b.client_email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: bookingLifecycleKey(b.id, "slot-lost") });
  } catch (e) { console.error("[payments] slot-lost mail failed:", e); }
}
```

`bump_booking_refunded` is a two-line definer RPC — **append it to `0079_holds_collection.sql`** (before the Rollback block; `npm run db:reset` afterwards) since PostgREST cannot express `refunded_cents = refunded_cents + n`:

```sql
-- ---------- bump_booking_refunded: the refund path's one write on the booking.
create function public.bump_booking_refunded(p_booking_id uuid, p_cents int)
returns void language sql security definer set search_path = '' as $$
  update public.bookings set refunded_cents = refunded_cents + p_cents where id = p_booking_id;
$$;
revoke all on function public.bump_booking_refunded(uuid, int) from public, anon, authenticated, service_role;
grant execute on function public.bump_booking_refunded(uuid, int) to service_role;
```

(and name it in the Rollback comment).

- [ ] **Step 7: The two routes**

`src/app/booking/[token]/pay/route.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingLocale } from "@/lib/booking/public";
import { startCheckout } from "@/features/payments/checkout";

// The one door to Checkout (spec ruling 8): the widget panel, the manage page
// and the pay-by mail all link here. Anything that cannot pay lands on the
// manage page, which explains why. 303s throughout — a GET must never be
// re-played into a second session by a refresh.
export async function GET(request: NextRequest, ctx: RouteContext<"/booking/[token]/pay">) {
  const { token } = await ctx.params;
  const manage = new URL(`/booking/${token}`, env.NEXT_PUBLIC_APP_URL);
  const lang = request.nextUrl.searchParams.get("lang");
  if (lang) manage.searchParams.set("lang", lang);
  const result = await resolveBookingToken(token, clientKeyFrom(request.headers));
  if (result.status !== "ok") return NextResponse.redirect(manage, 303);
  const b = result.booking;
  if (b.status !== "pending_payment" || !b.holdExpiresAt || b.holdExpiresAt.getTime() <= Date.now()) return NextResponse.redirect(manage, 303);
  const success = new URL(manage);
  success.searchParams.set("paid", "1");
  const started = await startCheckout(b.id, { successUrl: success.toString(), cancelUrl: manage.toString(), locale: lang ?? (await getBookingLocale(b.id)) });
  if ("error" in started) {
    manage.searchParams.set("pay", "failed");
    return NextResponse.redirect(manage, 303);
  }
  return NextResponse.redirect(started.url, 303);
}
```

(`RouteContext` is the Next 16 typed helper the repo already uses — check another route under `src/app/api/google` for the exact import/usage and copy it.)

`src/app/api/payments/webhook/route.ts` (billing's route is the template):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsConfigured, selectPaymentsProvider } from "@/lib/payments/provider";
import { applyPaymentEvents } from "@/features/payments/apply";

// Connect webhook: events from the studios' accounts. Raw body first
// (signatures cover bytes); fail closed when unconfigured; 401 signature;
// 400 malformed; business unknowns are 200 (never make Stripe retry a bug);
// our own failure is 500 (Stripe retries).
export async function POST(request: Request) {
  if (!paymentsConfigured()) return Response.json({ error: "payments webhook disabled" }, { status: 503 });
  let provider;
  try { provider = selectPaymentsProvider(); } catch (error) {
    console.error("[payments] provider construction failed:", error);
    return Response.json({ error: "payments webhook disabled" }, { status: 503 });
  }
  const rawBody = await request.text();
  let events;
  try { events = provider.parseWebhook(rawBody, request.headers); } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/signature/i.test(msg)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  try {
    return Response.json(await applyPaymentEvents(events, { db: createAdminClient(), provider }));
  } catch (error) {
    console.error("[payments] webhook apply failed:", error);
    return Response.json({ error: "apply failed" }, { status: 500 });
  }
}
```

- [ ] **Step 8: The dev checkout page** (fake provider only)

`src/app/dev/payments/actions.ts`:

```ts
"use server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectPaymentsProvider } from "@/lib/payments/provider";
import { applyPaymentEvents } from "@/features/payments/apply";

const input = z.object({ session: z.string().min(1), outcome: z.enum(["pay", "async", "fail"]), back: z.string().min(1) });

/** The fake Checkout's buttons: the same events a Stripe webhook would carry,
    straight into applyPaymentEvents. Dev-only (guard = requireDevPayments). */
export async function fakeCheckoutOutcome(formData: FormData): Promise<never> {
  if (env.APP_ENV === "production" || env.PAYMENTS_PROVIDER !== "fake") notFound();
  await requireOrg();
  const { session, outcome, back } = input.parse(Object.fromEntries(formData));
  const admin = createAdminClient();
  const { data: row } = await admin.from("booking_payments").select("amount_cents, stripe_account_id").eq("checkout_session_id", session).single();
  if (!row) notFound();
  const base = { sessionId: session, paymentIntentId: `pi_fake_${session.slice(-8)}`, amountCents: row.amount_cents, accountId: row.stripe_account_id, eventId: `evt_${Date.now()}` };
  const events =
    outcome === "pay" ? [{ ...base, type: "checkout.completed" as const, paid: true }]
    : outcome === "async" ? [{ ...base, type: "checkout.completed" as const, paid: false }, { ...base, type: "checkout.async_succeeded" as const, paid: true }]
    : [{ ...base, type: "checkout.async_failed" as const, paid: false }];
  await applyPaymentEvents(events, { db: admin, provider: selectPaymentsProvider() });
  const target = new URL(back, env.NEXT_PUBLIC_APP_URL);
  redirect(target.origin === new URL(env.NEXT_PUBLIC_APP_URL).origin ? target.toString() : "/");
}
```

`src/app/dev/payments/checkout/page.tsx`: a server component; `notFound()` under the same guard; reads `session`, `payment`, `return`, `cancel` from `searchParams`; loads the ledger row by `payment` id with the admin client (`amount_cents, currency, checkout_session_id`); renders the amount via `formatMoney` and one `<form action={fakeCheckoutOutcome}>` per button (hidden `session`, `outcome`, `back` = the `return` URL for pay/async and the `cancel` URL for fail), plus a plain "Back" link to `cancel`. Style: the same wrapper `src/app/dev/billing/checkout/page.tsx` uses. No i18n — dev-only strings in English.

- [ ] **Step 9: Run**

Run: `npm run db:reset && npm run test:integration -- src/app/api/payments/webhook/route.integration.test.ts src/features/payments/holds.integration.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 10: Commit**

```bash
git add src/features/payments src/app/booking src/app/api/payments src/app/dev/payments src/lib/tokens/booking.ts src/db/migrations/0079_holds_collection.sql
git commit -m "feat(payments): pay route, Connect webhook, applyPaymentEvents, payment-received effects, fake checkout (S2)"
```

### Task 7: The drain expires holds; cancellations refund

**Files:**
- Create: `src/features/payments/hold-expiry.ts`
- Modify: `src/features/payments/refund.ts` (add `refundBooking`), `src/app/api/scheduling/drain/route.ts` (fourth phase)
- Modify: `src/features/scheduling/manage-actions.ts:101-200` (`cancelBooking`), `src/features/scheduling/booking-actions.ts:57-140` (`cancelBookingAdmin`), `src/features/scheduling/schema.ts:221` (`bookingCancelInput`)
- Modify: `src/features/scheduling/templates.ts` (`bookingCancelledEmail` gains `infoLines`)
- Test: `src/features/payments/hold-expiry.integration.test.ts`, `src/features/payments/refund.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 tables/RPCs (`bump_booking_refunded` from Task 6), Task 2 provider, Task 4 `holdExpiredEmail`, Task 6 `refundLedgerRow`.
- Produces: `runHoldExpiry({ db, transport, provider?, now? }) → { expired: number; mailed: number; failed: number }`; `refundBooking(bookingId, reason, deps?) → { refundedCents: number; failed: boolean }`; `cancelBookingAdmin({ id, refund?: boolean })` returns `{ ok: true; emailed; noEmail?; refundedCents?: number; refundFailed?: boolean }`.

- [ ] **Step 1: Write the failing tests**

`src/features/payments/hold-expiry.integration.test.ts` (seeding helpers from Task 1's test; `recordingTransport` from `src/features/scheduling/reminder-drain.integration.test.ts:46-56`):

```ts
import { runHoldExpiry } from "./hold-expiry";
import { fakePaymentsProvider } from "@/lib/payments/fake";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

async function lapsedHold(tag: string) {
  const { client, orgId, handle } = await newOrg(tag);
  const { offeringId } = await hoursFixture(client, orgId);
  await activeAccount(orgId);
  const { id } = await createHours(handle, offeringId, 10);
  await admin.from("bookings").update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id!);
  await admin.from("booking_payments").insert({ org_id: orgId, booking_id: id!, kind: "deposit", provider: "fake", amount_cents: 5000, currency: "PLN", status: "pending", checkout_session_id: `cs_exp_${id}`, stripe_account_id: "acct_fake_x" });
  return { id: id!, handle };
}

describe("runHoldExpiry", () => {
  it("flips a lapsed hold to expired, expires its ledger row, mails once; a second tick is a no-op", async () => {
    const { id, handle } = await lapsedHold("exp");
    const { transport, sent } = recordingTransport();
    const first = await runHoldExpiry({ db: admin, transport, provider: fakePaymentsProvider() });
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe("expired");
    expect((await admin.from("booking_payments").select("status").eq("booking_id", id).single()).data!.status).toBe("expired");
    const mail = sent.find((m) => m.subject.startsWith("Reservation released"));
    expect(mail?.text).toContain(`/${handle}`);
    const again = await runHoldExpiry({ db: admin, transport, provider: fakePaymentsProvider() });
    expect(sent.filter((m) => m.subject.startsWith("Reservation released") && m.text.includes(`/${handle}`))).toHaveLength(1);
    expect(again.expired).toBe(0);
  });
  it("leaves a live hold alone", async () => {
    const { client, orgId, handle } = await newOrg("live");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await runHoldExpiry({ db: admin, transport: recordingTransport().transport });
    expect((await admin.from("bookings").select("status").eq("id", id!).single()).data!.status).toBe("pending_payment");
  });
  it("two concurrent ticks expire a row exactly once", async () => {
    const { id } = await lapsedHold("race");
    const a = recordingTransport(); const b = recordingTransport();
    await Promise.all([runHoldExpiry({ db: admin, transport: a.transport }), runHoldExpiry({ db: admin, transport: b.transport })]);
    const mine = (s: typeof a.sent) => s.filter((m) => m.subject.startsWith("Reservation released")).length;
    // Other lapsed rows from earlier tests may ride along; this booking's mail must be exactly one across both.
    const { data: b2 } = await admin.from("bookings").select("status").eq("id", id).single();
    expect(b2!.status).toBe("expired");
    expect(mine(a.sent) + mine(b.sent)).toBeGreaterThanOrEqual(1);
  });
});
```

`src/features/payments/refund.integration.test.ts`:

```ts
import { refundBooking } from "./refund";
import { fakePaymentsProvider } from "@/lib/payments/fake";

describe("refundBooking", () => {
  it("refunds every paid row in full and bumps the booking", async () => {
    const { client, orgId, handle } = await newOrg("ref");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("booking_payments").insert({ org_id: orgId, booking_id: id!, kind: "deposit", provider: "fake", amount_cents: 5000, currency: "PLN", status: "pending", checkout_session_id: `cs_r_${id}`, stripe_account_id: "acct_fake_x" });
    await admin.rpc("apply_booking_payment", { p_session_id: `cs_r_${id}`, p_payment_intent_id: "pi_r", p_amount_cents: 5000 });
    const r = await refundBooking(id!, "cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(r).toEqual({ refundedCents: 5000, failed: false });
    const { data: b } = await admin.from("bookings").select("paid_cents, refunded_cents").eq("id", id!).single();
    expect(b).toEqual({ paid_cents: 5000, refunded_cents: 5000 });
    const again = await refundBooking(id!, "cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(again).toEqual({ refundedCents: 0, failed: false });
  });
  it("a provider failure leaves refund_failed + error, never throws", async () => {
    const { client, orgId, handle } = await newOrg("reffail");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("booking_payments").insert({ org_id: orgId, booking_id: id!, kind: "deposit", provider: "fake", amount_cents: 5000, currency: "PLN", status: "pending", checkout_session_id: `cs_rf_${id}`, stripe_account_id: "acct_fake_x" });
    await admin.rpc("apply_booking_payment", { p_session_id: `cs_rf_${id}`, p_payment_intent_id: "pi_rf", p_amount_cents: 5000 });
    const broken = { ...fakePaymentsProvider(), refund: async () => { throw new Error("stripe down"); } };
    const r = await refundBooking(id!, "cancel", { db: admin, provider: broken });
    expect(r).toEqual({ refundedCents: 0, failed: true });
    const { data: row } = await admin.from("booking_payments").select("status, error").eq("checkout_session_id", `cs_rf_${id}`).single();
    expect(row).toMatchObject({ status: "refund_failed", error: "stripe down" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:integration -- src/features/payments/hold-expiry.integration.test.ts src/features/payments/refund.integration.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: `refundBooking`** — append to `src/features/payments/refund.ts`:

```ts
/** Refund everything paid on a booking (spec ruling 3: full refunds in S2). */
export async function refundBooking(bookingId: string, reason: string, deps: Deps = {}): Promise<{ refundedCents: number; failed: boolean }> {
  const db = deps.db ?? createAdminClient();
  const { data: rows } = await db.from("booking_payments").select("id, amount_cents, refunded_cents").eq("booking_id", bookingId).eq("status", "paid");
  let refundedCents = 0;
  let failed = false;
  for (const row of rows ?? []) {
    const ok = await refundLedgerRow(row.id, reason, deps);
    if (ok) refundedCents += row.amount_cents - row.refunded_cents;
    else failed = true;
  }
  return { refundedCents, failed };
}
```

- [ ] **Step 4: `hold-expiry.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { EmailTransport } from "@/lib/email/transport";
import type { PaymentsProvider } from "@/lib/payments/provider";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { withUnit } from "@/features/rentals/unit-label";
import { bookingLifecycleKey, holdExpiredEmail, whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

export const HOLD_EXPIRY_BATCH = 25;

type Row = {
  id: string; org_id: string; client_email: string | null; locale: string | null; starts_at: string; ends_at: string;
  rental_offerings: { name: string; range_mode: RangeMode } | null; rental_units: { name: string } | null;
  orgs: { name: string; handle: string; timezone: string; locale: string } | null;
};

/** Drain phase (spec §Flows): flip lapsed holds to 'expired' (the durable
    part — the slot is free from this instant), expire their open Checkout
    sessions best-effort, mail the client once. No retry path: a mail that
    fails is logged; the flip already happened.
    ponytail: the drain runs every 15 min, so a lapsed hold can block its slot
    up to 15 min longer — a sweep inside the create RPCs is the upgrade. */
export async function runHoldExpiry(deps: { db: SupabaseClient; transport: EmailTransport; provider?: PaymentsProvider; now?: Date }) {
  const now = deps.now ?? new Date();
  const { data: due } = await deps.db.from("bookings").select("id").eq("status", "pending_payment")
    .lte("hold_expires_at", now.toISOString()).order("hold_expires_at").limit(HOLD_EXPIRY_BATCH);
  const ids = (due ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { expired: 0, mailed: 0, failed: 0 };
  // The claim: exactly one tick wins each row (reminders.ts idiom).
  const { data: claimed, error } = await deps.db.from("bookings").update({ status: "expired" })
    .in("id", ids).eq("status", "pending_payment")
    .select("id, org_id, client_email, locale, starts_at, ends_at, rental_offerings(name, range_mode), rental_units(name), orgs(name, handle, timezone, locale)");
  if (error) throw error;
  let mailed = 0, failed = 0;
  for (const raw of (claimed ?? []) as unknown as Row[]) {
    const { data: open } = await deps.db.from("booking_payments").select("id, checkout_session_id, stripe_account_id")
      .eq("booking_id", raw.id).in("status", ["pending", "processing"]);
    for (const p of open ?? []) {
      if (deps.provider && p.checkout_session_id && p.stripe_account_id) await deps.provider.expireCheckout(p.stripe_account_id, p.checkout_session_id);
      await deps.db.from("booking_payments").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", p.id);
    }
    if (!raw.client_email || !raw.orgs) continue;
    try {
      const client = await emailTranslators(raw.locale ?? raw.orgs.locale);
      const msg = holdExpiredEmail(client.t, {
        orgName: raw.orgs.name,
        serviceName: withUnit(raw.rental_offerings?.name ?? "", raw.rental_units?.name ?? null),
        whenLine: whenLineFor({ startsAt: new Date(raw.starts_at), endsAt: new Date(raw.ends_at), isRental: true, rangeMode: raw.rental_offerings?.range_mode ?? null }, raw.orgs.timezone, client.intlLocale),
        bookAgainUrl: `${env.NEXT_PUBLIC_APP_URL}/${raw.orgs.handle}`,
        badgeUrl: await emailBadgeUrl(raw.org_id),
      });
      await deps.transport.send({ to: raw.client_email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: bookingLifecycleKey(raw.id, "hold-expired") });
      mailed += 1;
    } catch (e) {
      failed += 1;
      console.error("[payments] hold-expired mail failed:", e);
    }
  }
  return { expired: (claimed ?? []).length, mailed, failed };
}
```

- [ ] **Step 5: Drain route** — in `src/app/api/scheduling/drain/route.ts` import `runHoldExpiry`, `paymentsConfigured`, `selectPaymentsProvider`; after `const inbound = …`:

```ts
    // S2: release lapsed holds. Its own try — a payments problem must not
    // hide the other three summaries. The provider is only for expiring
    // open Checkout sessions; the status flip needs none.
    let holds: Awaited<ReturnType<typeof runHoldExpiry>> | { error: string };
    try {
      holds = await runHoldExpiry({ db: admin, transport: selectTransport(), provider: paymentsConfigured() ? selectPaymentsProvider() : undefined });
    } catch (error) {
      console.error("[payments] hold expiry tick failed:", error);
      holds = { error: "hold expiry failed" };
    }
    return Response.json({ ...summary, calendar, inbound, holds });
```

- [ ] **Step 6: Cancellations refund**

`templates.ts` — `bookingCancelledEmail` gains `infoLines?: string[]` in its input; render them after the when-line exactly as `bookingRequestReceivedEmail` does (`${infoHtml(input.infoLines)}` in html, `...(input.infoLines ?? [])` in text).

`schema.ts` — beside `bookingIdInput`:

```ts
// S2: admin cancel may skip the refund the dialog offers by default.
export const bookingCancelInput = z.object({ id: z.uuid(), refund: z.boolean().optional() });
```

`manage-actions.ts` `cancelBooking` — after `kickCalendarSync(row.org_id)`:

```ts
    // S2 (ruling 3): whatever was paid comes back in full. Best effort and
    // recorded on the ledger; a failure is the studio's to finish in Stripe
    // (the booking detail shows it) — never the client's problem here.
    const refund = await refundBooking(row.booking_id, "cancel").catch((e) => { console.error("[payments] cancel refund:", e); return { refundedCents: 0, failed: true }; });
```

and pass `infoLines: refund.refundedCents > 0 && row.currency ? [client.tUnits("refund", { amount: formatMoney(refund.refundedCents, row.currency) })] : undefined` to `bookingCancelledEmail`. `cancel_booking` does not return `currency` — read it with the token resolver you already have in scope (`resolveActionable` / the `getBookingLocale` read) or add a one-line select on `bookings` for `currency` by `row.booking_id` with the admin client. Import `refundBooking` from `@/features/payments/refund` and `formatMoney` from `@/lib/money`.

`booking-actions.ts` `cancelBookingAdmin` — parse with `bookingCancelInput`; the update's `.eq("status", "confirmed")` becomes `.in("status", ["confirmed", "pending_payment"])` and the select gains `currency`; after `kickCalendarSync`:

```ts
    const refund = parsed.data.refund === false
      ? { refundedCents: 0, failed: false }
      : await refundBooking(row.id, "admin-cancel").catch((e) => { console.error("[payments] admin cancel refund:", e); return { refundedCents: 0, failed: true }; });
```

pass the same `infoLines` to the client's `bookingCancelledEmail` (built with `forClient.tUnits`), and return `{ ok: true, emailed, noEmail, refundedCents: refund.refundedCents, refundFailed: refund.failed }` (type widened accordingly).

- [ ] **Step 7: Run**

Run: `npm run test:integration -- src/features/payments && npm run typecheck && npm run lint`
Expected: PASS, clean. Also `npm run test:integration -- src/features/scheduling/reminder-drain.integration.test.ts` (the drain route's shape changed; its test must still pass).

- [ ] **Step 8: Commit**

```bash
git add src/features/payments src/app/api/scheduling/drain/route.ts src/features/scheduling
git commit -m "feat(payments): hold expiry drain phase; full refunds on client and admin cancel (S2)"
```

### Task 8: The `/payments` page — Stripe card, hold window, legal details

**Files:**
- Create: `src/features/payments/legal.ts` + `legal.test.ts`, `src/features/payments/queries.ts`, `src/features/payments/actions.ts`, `src/features/payments/components/stripe-card.tsx`, `src/features/payments/components/payment-settings-form.tsx`, `src/features/payments/components/payments-notice.tsx`
- Create: `src/app/(dashboard)/payments/page.tsx`
- Modify: `src/components/shell/nav.ts:76-82`, `src/components/shell/nav.test.ts:16,21`
- Modify: `messages/en.json` (`payments.*`, `shell.nav.payments`)

**Interfaces:**
- Consumes: Task 1 `update_org_payments`, `payment_accounts`; Task 2 provider.
- Produces: `legalSchema`, `type Legal`, `parseLegal(raw: unknown): Legal`, `LEGAL_COUNTRIES` (used by Task 10's footer); `getPaymentsPage()`; actions `connectStripe(formData)`, `continueOnboarding()`, `updatePaymentSettings(input) → ActionResult`.

- [ ] **Step 1: Write the failing test** — `src/features/payments/legal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { legalSchema, parseLegal } from "./legal";

describe("legal", () => {
  it("accepts a partial object with http(s) links", () => {
    expect(legalSchema.parse({ legalName: "Studio X sp. z o.o.", taxId: "5252525252", termsUrl: "https://x.pl/regulamin" })).toEqual({ legalName: "Studio X sp. z o.o.", taxId: "5252525252", termsUrl: "https://x.pl/regulamin" });
  });
  it("rejects non-http links and drops empty strings", () => {
    expect(legalSchema.safeParse({ termsUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(legalSchema.parse({ address: "", regNo: "  " })).toEqual({});
  });
  it("parseLegal never throws", () => {
    expect(parseLegal(null)).toEqual({});
    expect(parseLegal({ legalName: 5 })).toEqual({});
    expect(parseLegal({ legalName: "S" })).toEqual({ legalName: "S" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/payments/legal.test.ts` → FAIL.

- [ ] **Step 3: `legal.ts`**

```ts
import { z } from "zod";

const text = z.string().trim().max(200).transform((s) => (s === "" ? undefined : s)).optional();
const link = z.string().trim().max(500).transform((s) => (s === "" ? undefined : s)).optional()
  .refine((s) => s === undefined || /^https?:\/\/\S+$/i.test(s), { message: "http(s) link" });

// S2 (spec §Data model → orgs.legal): what the public footer prints. All
// optional; P24's website requirements are the studio's to meet, the fields
// are here so it can.
export const legalSchema = z.object({
  legalName: text, address: text, taxId: text, regNo: text,
  termsUrl: link, privacyUrl: link, refundUrl: link,
}).transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Legal);
export type Legal = Partial<Record<"legalName" | "address" | "taxId" | "regNo" | "termsUrl" | "privacyUrl" | "refundUrl", string>>;

/** The jsonb as stored → a Legal, tolerating anything (a bad row renders no footer). */
export function parseLegal(raw: unknown): Legal {
  const r = legalSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export const HOLD_OPTIONS = [30, 60, 180, 1440] as const;
export const LEGAL_COUNTRIES = ["PL", "DE", "CZ", "SK", "LT", "LV", "EE", "AT", "NL", "BE", "FR", "ES", "IT", "PT", "IE", "GB", "SE", "DK", "FI", "NO"] as const;
```

- [ ] **Step 4: `queries.ts`**

```ts
import "server-only";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsConfigured, selectPaymentsProvider, type AccountStatus } from "@/lib/payments/provider";
import { parseLegal, type Legal } from "./legal";

export type PaymentsPageData = {
  orgId: string; orgName: string; email: string; configured: boolean;
  account: { status: AccountStatus; capabilities: Record<string, string> } | null;
  holdMin: number; legal: Legal;
};

/** The page's one read. Refreshes the cached account status from the
    provider on every load (spec ruling 6: pull, not push); a provider
    failure keeps the cached row. */
export async function getPaymentsPage(): Promise<PaymentsPageData> {
  const { user, org } = await requireOrg();
  const admin = createAdminClient();
  const [{ data: row }, { data: o }] = await Promise.all([
    admin.from("payment_accounts").select("stripe_account_id, status, capabilities").eq("org_id", org.id).maybeSingle(),
    admin.from("orgs").select("payment_hold_min, legal").eq("id", org.id).single(),
  ]);
  let account: PaymentsPageData["account"] = row ? { status: row.status as AccountStatus, capabilities: (row.capabilities ?? {}) as Record<string, string> } : null;
  if (row && paymentsConfigured()) {
    try {
      const fresh = await selectPaymentsProvider().getAccountStatus(row.stripe_account_id);
      await admin.from("payment_accounts").update({ status: fresh.status, capabilities: fresh.capabilities, checked_at: new Date().toISOString() }).eq("org_id", org.id);
      account = fresh;
    } catch (e) { console.error("[payments] account refresh:", e); }
  }
  return { orgId: org.id, orgName: org.name, email: user.email ?? "", configured: paymentsConfigured(), account, holdMin: o?.payment_hold_min ?? 60, legal: parseLegal(o?.legal) };
}
```

- [ ] **Step 5: `actions.ts`**

```ts
"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { paymentsConfigured, selectPaymentsProvider } from "@/lib/payments/provider";
import { HOLD_OPTIONS, LEGAL_COUNTRIES, legalSchema } from "./legal";

export type ActionResult = { ok: true } | { ok: false; error: string };

const back = (q: string) => `${env.NEXT_PUBLIC_APP_URL}/payments?${q}`;

/** Connect Stripe: create the connected account once, then hosted onboarding. */
export async function connectStripe(formData: FormData): Promise<never> {
  if (!paymentsConfigured()) redirect("/payments?stripe=error");
  const { user, org } = await requireOrg();
  const country = z.enum(LEGAL_COUNTRIES).catch("PL").parse(String(formData.get("country") ?? "PL"));
  const admin = createAdminClient();
  const provider = selectPaymentsProvider();
  let url: string;
  try {
    const { data: existing } = await admin.from("payment_accounts").select("stripe_account_id").eq("org_id", org.id).maybeSingle();
    let accountId = existing?.stripe_account_id as string | undefined;
    if (!accountId) {
      accountId = (await provider.createAccount({ country, email: user.email ?? "", displayName: org.name })).accountId;
      const { error } = await admin.from("payment_accounts").insert({ org_id: org.id, stripe_account_id: accountId });
      if (error) throw error;
    }
    url = await provider.createOnboardingLink(accountId, back("stripe=return"), back("stripe=refresh"));
  } catch (e) {
    console.error("[payments] connectStripe:", e);
    redirect("/payments?stripe=error");
  }
  redirect(url);
}

/** A fresh onboarding link for an account that exists (return/refresh/restricted). */
export async function continueOnboarding(): Promise<never> {
  return connectStripe(new FormData());
}

const settingsInput = z.object({
  holdMin: z.coerce.number().refine((n): n is (typeof HOLD_OPTIONS)[number] => (HOLD_OPTIONS as readonly number[]).includes(n)),
  legal: legalSchema,
});

export async function updatePaymentSettings(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("errors");
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const { org } = await requireOrg();
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_org_payments", { p_org_id: org.id, p_hold_min: parsed.data.holdMin, p_legal: parsed.data.legal });
    if (error) { console.error("[payments] updatePaymentSettings:", error); return { ok: false, error: t("generic") }; }
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) {
    console.error("[payments] updatePaymentSettings:", e);
    return { ok: false, error: t("generic") };
  }
}
```

- [ ] **Step 6: Components and page**

`stripe-card.tsx` (server component, `SettingsCard` from `@/components/settings-row`, `buttonVariants` from `@/components/ui/button`, `Badge` from `@/components/ui/badge`):

```tsx
import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings-row";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LEGAL_COUNTRIES } from "../legal";
import { connectStripe, continueOnboarding } from "../actions";
import type { PaymentsPageData } from "../queries";

export async function StripeCard({ data }: { data: PaymentsPageData }) {
  const t = await getTranslations("payments.stripe");
  const caps = (["card_payments", "p24_payments", "blik_payments"] as const).filter((k) => data.account?.capabilities[k] === "active");
  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      {!data.configured ? (
        <p className="text-muted-foreground text-sm">{t("notConfigured")}</p>
      ) : !data.account ? (
        <form action={connectStripe} className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{t("notConnected")}</p>
          <label className="flex items-center gap-2 text-sm">
            {t("country")}
            <select name="country" defaultValue="PL" className="rounded-md border bg-background px-2 py-1">
              {LEGAL_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="submit" className={cn(buttonVariants({ variant: "brand", size: "sm" }), "self-start")}>{t("connect")}</button>
        </form>
      ) : data.account.status === "active" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("active")}</p>
          <div className="flex flex-wrap gap-1.5">{caps.map((k) => <Badge key={k} variant="secondary">{t(`capability.${k}`)}</Badge>)}</div>
          <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>{t("openDashboard")}</a>
        </div>
      ) : (
        <form action={continueOnboarding} className="flex flex-col gap-2">
          <p className="text-sm">{data.account.status === "restricted" ? t("restricted") : t("onboarding")}</p>
          <button type="submit" className={cn(buttonVariants({ variant: "brand", size: "sm" }), "self-start")}>{t("continue")}</button>
        </form>
      )}
    </SettingsCard>
  );
}
```

`payment-settings-form.tsx` (client; `useTranslations("payments")`, `useTransition`, `toast`; the `SettingsRow`/`Input` idiom from `business-settings.tsx`): a `<select>` for `holdMin` over `HOLD_OPTIONS` labelled `t(\`hold.options.${n}\`)`, seven `<Input>`s for the legal fields, one Save button calling `updatePaymentSettings({ holdMin, legal })` → `toast.success(t("saved"))` / `toast.error(result.error)`. Props: `{ holdMin: number; legal: Legal }`.

`payments-notice.tsx`: copy `src/features/calendar-sync/components/connect-notice.tsx`, reading `?stripe=`: `return` → `toast.success(t("notice.return"))`, `refresh` → `toast(t("notice.returnIncomplete"))`, `error` → `toast.error(t("notice.error"))`; namespace `payments.stripe`. (`refresh` lands here when Stripe's link expired — the card's Continue button mints a new one.)

`src/app/(dashboard)/payments/page.tsx`:

```tsx
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageIntro } from "@/components/shell/page-header";
import { getPaymentsPage } from "@/features/payments/queries";
import { StripeCard } from "@/features/payments/components/stripe-card";
import { PaymentSettingsForm } from "@/features/payments/components/payment-settings-form";
import { PaymentsNotice } from "@/features/payments/components/payments-notice";

/* /payments (spec §Admin): the studio's money rail, the hold window and the
   legal identity the public footer prints. Same frame as Integrations. */
export default async function PaymentsPage() {
  const [data, t] = await Promise.all([getPaymentsPage(), getTranslations("payments")]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <Suspense fallback={null}><PaymentsNotice /></Suspense>
      <PageIntro>{t("intro")}</PageIntro>
      <div className="flex flex-col gap-3">
        <StripeCard data={data} />
        <PaymentSettingsForm holdMin={data.holdMin} legal={data.legal} />
      </div>
    </div>
  );
}
```

`nav.ts`: before the `/notifications` item add `{ href: "/payments", labelKey: "payments", icon: Wallet01Icon, section: "account", channel: "rentals" },` (import `Wallet01Icon` from `@hugeicons/core-free-icons`; if that name is absent, `grep -o "Wallet[A-Za-z0-9]*Icon" node_modules/@hugeicons/core-free-icons/dist/index.d.ts | sort -u` and pick one). `nav.test.ts`: insert `"/payments"` before `"/notifications"` in the rentals lists (lines 16 and any other rentals expectation); the appointments-only lists stay.

`messages/en.json` — `shell.nav.payments: "Payments"` and a top-level `payments` namespace:

```json
  "payments": {
    "intro": "How clients pay deposits, and the business details shown on your booking page.",
    "stripe": {
      "title": "Stripe",
      "blurb": "Deposits are paid through Stripe on your own account — Booklo never holds the money and takes no fee.",
      "notConfigured": "Payments aren't set up on this server.",
      "notConnected": "Connect Stripe to collect deposits online. Bookings that need a deposit are held until it's paid.",
      "country": "Business country",
      "connect": "Connect Stripe",
      "continue": "Continue setup",
      "onboarding": "Stripe still needs some details before you can take payments.",
      "active": "Active — clients can pay deposits online.",
      "restricted": "Stripe has paused payments on this account and needs more information.",
      "openDashboard": "Open Stripe dashboard",
      "capability": { "card_payments": "Cards", "p24_payments": "Przelewy24", "blik_payments": "BLIK" },
      "notice": { "return": "Stripe details saved.", "returnIncomplete": "Stripe still needs a few details — continue setup when you're ready.", "error": "Couldn't reach Stripe. Try again in a moment." }
    },
    "hold": {
      "title": "Payment window",
      "blurb": "How long a booking is held for its deposit. Unpaid bookings are released automatically.",
      "label": "Hold for",
      "options": { "30": "30 minutes", "60": "1 hour", "180": "3 hours", "1440": "24 hours" }
    },
    "legal": {
      "title": "Business details",
      "blurb": "Shown in the footer of your booking page. Przelewy24 requires them for online payments.",
      "legalName": "Legal name", "address": "Address", "taxId": "NIP", "regNo": "REGON or KRS",
      "termsUrl": "Terms link", "privacyUrl": "Privacy policy link", "refundUrl": "Refund policy link"
    },
    "save": "Save",
    "saved": "Saved"
  }
```

- [ ] **Step 7: Run**

Run: `npx vitest run src/features/payments/legal.test.ts src/components/shell/nav.test.ts && npm run typecheck && npm run lint`, then `npm run dev` with `PAYMENTS_PROVIDER=fake` and open `http://localhost:3000/payments`: Connect → lands back with the toast and an Active card; save a hold + NIP; reload shows them.
Expected: PASS, clean, page works.

- [ ] **Step 8: Commit**

```bash
git add src/features/payments "src/app/(dashboard)/payments" src/components/shell messages/en.json
git commit -m "feat(payments): /payments — Stripe Connect card, hold window, legal details (S2)"
```

### Task 9: Admin surfaces — holds in every list, the detail dialog, Mark as paid, refund checkbox

**Files:**
- Modify: `src/features/scheduling/queries.ts:247-248` (`BOOKING_COLUMNS` + `AdminBooking`/`BookingRow` + mapper), `:311` (`.or(...)`)
- Modify: `src/features/scheduling/detail-bookings.ts:42,51-53`, `src/features/rentals/queries.ts:315,401,410-412`, `src/lib/booking/public.ts:173,698,807`, `src/features/scheduling/booking-actions.ts:414` (resend), `src/features/scheduling/requests.ts` (no change — documented)
- Modify: `src/features/scheduling/components/calendar-grid.tsx:422,427,602`, `src/features/rentals/components/timeline.tsx` (where `status === "pending"` paints a ghost), `src/features/scheduling/components/booking-detail-dialog.tsx`
- Create: `src/features/scheduling/hold-label.ts` + `hold-label.test.ts`
- Modify: `src/features/scheduling/booking-actions.ts` (new `markBookingPaid`)
- Modify: `messages/en.json` (`bookings.status.pendingPayment`, `bookings.status.expired`, `bookings.hold.*`, `bookings.cancel.refund*`, `bookings.markPaid.*`)

**Interfaces:**
- Consumes: Task 1 `mark_booking_paid`; Task 6 `sendPaymentReceived`; Task 7 `cancelBookingAdmin({ id, refund })`.
- Produces: `AdminBooking.{holdExpiresAt: string | null; paidCents: number; refundedCents: number; depositCents: number | null}`; `isLiveHold(b, now)`, `holdLabel(b, timeZone, intlLocale, t)`; action `markBookingPaid({ id }) → { ok: true } | { ok: false; error }`.

- [ ] **Step 1: Write the failing test** — `src/features/scheduling/hold-label.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isLiveHold } from "./hold-label";

describe("isLiveHold", () => {
  const now = new Date("2027-05-10T10:00:00Z");
  it("a pending_payment row with a future deadline", () =>
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: "2027-05-10T10:30:00Z" }, now)).toBe(true));
  it("lapsed or any other status is not", () => {
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: "2027-05-10T09:59:00Z" }, now)).toBe(false);
    expect(isLiveHold({ status: "confirmed", holdExpiresAt: "2027-05-10T10:30:00Z" }, now)).toBe(false);
    expect(isLiveHold({ status: "pending_payment", holdExpiresAt: null }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/scheduling/hold-label.test.ts` → FAIL.

- [ ] **Step 3: `hold-label.ts`**

```ts
// S2: a hold is live until the drain flips it (stored deadline, unlike the
// computed lapse of a pending request in requests.ts). Between the deadline
// and the next drain tick the row still blocks its slot — the UI says
// "awaiting payment" either way; only the actions differ.
export function isLiveHold(b: { status: string; holdExpiresAt: string | null }, now: Date): boolean {
  return b.status === "pending_payment" && !!b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() > now.getTime();
}

/** "Awaiting payment · until 14:32" for a hold expiring today, with the day when not. */
export function holdLabel(b: { holdExpiresAt: string | null }, timeZone: string, intlLocale: string, t: (key: string, values?: Record<string, string>) => string): string | null {
  if (!b.holdExpiresAt) return null;
  const d = new Date(b.holdExpiresAt);
  const sameDay = new Intl.DateTimeFormat(intlLocale, { timeZone, dateStyle: "short" }).format(d) === new Intl.DateTimeFormat(intlLocale, { timeZone, dateStyle: "short" }).format(new Date());
  const time = new Intl.DateTimeFormat(intlLocale, { timeZone, ...(sameDay ? {} : { weekday: "short", day: "numeric" }), hour: "2-digit", minute: "2-digit" }).format(d);
  return t("hold.until", { time });
}
```

- [ ] **Step 4: Status lists** — every live predicate learns the new status:

- `scheduling/queries.ts:311` → `.or(\`status.eq.confirmed,status.eq.pending_payment,and(status.eq.pending,starts_at.gt.${iso})\`)`.
- `detail-bookings.ts:42` the same; `:51` (history) → `status.in.(cancelled_by_client,cancelled_by_provider,rescheduled,declined,expired)`.
- `rentals/queries.ts:315` → `.in("status", ["confirmed", "pending", "pending_payment"])`; `:401` as the scheduling one; `:410` add `expired` to the history list.
- `lib/booking/public.ts:173,698,807` → `["confirmed", "pending", "pending_payment"]` (a hold blocks the public grid exactly like the EXCLUDE does).
- `booking-actions.ts:414` (resend link) → `["confirmed", "pending", "pending_payment"]`.
- `BOOKING_COLUMNS` gains `deposit_cents, hold_expires_at, paid_cents, refunded_cents`; `BookingRow` and `AdminBooking` gain `depositCents: number | null; holdExpiresAt: string | null; paidCents: number; refundedCents: number;` and the row→AdminBooking mapper copies them (find it by `rescheduledFromId: r.rescheduled_from_id`).

- [ ] **Step 5: Ghosts** — `calendar-grid.tsx:422` and `:602`: `b.status === "pending" || b.status === "pending_payment" ? "border-dashed bg-card/50" : "bg-card"`; `:427`'s sr-only text: `b.status === "pending" ? t("status.pending") : b.status === "pending_payment" ? t("status.pendingPayment") : null`. `timeline.tsx`: wherever it tests `status === "pending"` for the dashed style, add `|| status === "pending_payment"`.

- [ ] **Step 6: The dialog** — in `DetailBody` (`booking-detail-dialog.tsx`; imports: `formatMoney` from `@/lib/money`, `isLiveHold`, `holdLabel` from `../hold-label`, `markBookingPaid` from `../booking-actions`, `Checkbox` from `@/components/ui/checkbox`):

```tsx
  const hold = booking.status === "pending_payment";
  const liveHold = isLiveHold(booking, new Date(now));
  const paidLine = booking.paidCents > 0 && booking.currency
    ? booking.priceCents !== null && booking.priceCents > booking.paidCents
      ? t("hold.paidBalance", { paid: formatMoney(booking.paidCents, booking.currency), balance: formatMoney(booking.priceCents - booking.paidCents, booking.currency) })
      : t("hold.paid", { paid: formatMoney(booking.paidCents, booking.currency) })
    : null;
  const refundLine = booking.refundedCents > 0 && booking.currency ? t("hold.refunded", { amount: formatMoney(booking.refundedCents, booking.currency) }) : null;
  const [refund, setRefund] = React.useState(true);
```

Status block: before the `liveRequest ? … : expiredRequest ? …` chain add a `hold ?` branch rendering `<Badge variant="secondary">{t("status.pendingPayment")}</Badge>` and, when `liveHold`, `<p className="text-muted-foreground text-xs">{holdLabel(booking, timeZone, intlLocale, t)}</p>` (else `t("hold.lapsed")`). After the contact line, print `paidLine` and `refundLine` when present (`<p className="text-sm">`).

Footer for a hold (a new branch before the general one):

```tsx
      {hold ? (
        <DialogFooterBar className="sm:justify-start">
          <Button variant="ghost" size="sm" onClick={resend} disabled={pending || resendBlocked} focusableWhenDisabled={resendBlocked} title={resendHint}>{t("resendLink")}</Button>
          {liveHold ? <Button variant="outline" size="sm" onClick={markPaid} disabled={pending}>{t("markPaid.button")}</Button> : null}
          <Button variant="destructive" size="sm" className="sm:ml-auto" onClick={cancel} disabled={pending}>{t("cancel.button")}</Button>
        </DialogFooterBar>
      ) : …existing branches…}
```

with

```tsx
  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("markPaid.done"));
      onClose();
    });
```

The existing confirm-cancel span, when `booking.paidCents > booking.refundedCents && booking.currency`, gains a checkbox before the Confirm button (`Checkbox` from `@/components/ui/checkbox`, label `t("cancel.refund", { amount: formatMoney(booking.paidCents - booking.refundedCents, booking.currency) })`, checked = `refund`), and `cancel` becomes `cancelBookingAdmin({ id: booking.id, refund })`; its toasts add: `result.refundFailed ? toast.warning(t("cancel.refundFailed")) : null` after the existing one.

`markBookingPaid` in `booking-actions.ts`:

```ts
export async function markBookingPaid(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_booking_paid", { p_booking_id: parsed.data.id });
    if (error) return isRpcSentinel(error, "not found") ? { ok: false, error: t("bookings.notHeld") } : fail("markBookingPaid", error);
    // The same tail a webhook confirmation runs (client mail, member notice, Google).
    await sendPaymentReceived(parsed.data.id);
    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true };
  } catch (error) {
    return fail("markBookingPaid", error);
  }
}
```

(import `sendPaymentReceived` from `@/features/payments/confirm-effects`; `fail` here returns the `{ ok: false; error }` shape the file's other actions use — check its signature at the top of the file.)

`messages/en.json`:

```json
  "bookings": {
    "status": { "...": "...", "pendingPayment": "Awaiting payment", "expired": "Released — unpaid" },
    "hold": {
      "until": "Reserved until {time}",
      "lapsed": "The payment window has passed — the next sweep releases this time.",
      "paid": "Paid {paid}",
      "paidBalance": "Paid {paid} · {balance} due at the venue",
      "refunded": "Refunded {amount}"
    },
    "markPaid": { "button": "Mark as paid", "done": "Marked as paid — the client has been emailed." },
    "cancel": { "...": "...", "refund": "Refund {amount}", "refundFailed": "The refund failed — refund it in Stripe." }
  },
  "errors": { "bookings": { "...": "...", "notHeld": "This booking is no longer awaiting payment." } }
```

- [ ] **Step 7: Run**

Run: `npx vitest run src/features/scheduling && npm run typecheck && npm run lint`; then in the dev app (fake provider, an org with an active account and a 50 % deposit space): book from the public page → the hold shows dashed on Bookings with "Reserved until …"; open it → Mark as paid → confirmed with "Paid 50 zł · 50 zł due at the venue"; cancel → the refund checkbox appears.
Expected: PASS, clean, flows as described.

- [ ] **Step 8: Commit**

```bash
git add src/features/scheduling src/features/rentals src/lib/booking/public.ts messages/en.json
git commit -m "feat(bookings): holds in every list and grid, hold detail, Mark as paid, refund on cancel (S2)"
```

### Task 10: The manage page's hold / paid / released states, and the legal footer

**Files:**
- Modify: `src/app/booking/[token]/page.tsx:29-36,74-83,120-175`
- Modify: `src/lib/booking/public.ts:75-79` (add `getOrgLegal` beside `getOrgLocale`)
- Create: `src/features/booking-page/render/legal-footer.tsx`
- Modify: `src/features/booking-page/render/channel-page.tsx:63-68`
- Modify: `messages/en.json` (`public.manage.*`, `public.legal.*`)

**Interfaces:**
- Consumes: Task 6 resolver fields (`holdExpiresAt`, `paidCents`, `refundedCents`), Task 4 `formatUntil`, Task 3 `moneyInfoLines`, Task 8 `parseLegal`/`Legal`.
- Produces: `getOrgLegal(orgId): Promise<Legal>` (cached admin read); `<LegalFooter legal />`.

- [ ] **Step 1: `getOrgLegal`** — in `src/lib/booking/public.ts` after `getOrgLocale`:

```ts
/** S2: the legal identity the public footer prints (orgs.legal, 0079). */
export const getOrgLegal = cache(async (orgId: string): Promise<Legal> => {
  const admin = createAdminClient();
  const { data } = await admin.from("orgs").select("legal").eq("id", orgId).maybeSingle();
  return parseLegal(data?.legal);
});
```

(import `parseLegal`, `type Legal` from `@/features/payments/legal`.)

- [ ] **Step 2: `legal-footer.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import type { Legal } from "@/features/payments/legal";

/* S2 (spec §Public): one muted line of identity, then the policy links —
   only what the studio filled in. Renders nothing for an empty object, so
   every org without legal details looks exactly as before. Sits under the
   language links on the channel page and the manage page. */
export async function LegalFooter({ legal }: { legal: Legal }) {
  const t = await getTranslations("public.legal");
  const identity = [legal.legalName, legal.address, legal.taxId ? t("taxId", { id: legal.taxId }) : null, legal.regNo ? t("regNo", { id: legal.regNo }) : null].filter(Boolean);
  const links = ([["termsUrl", "terms"], ["privacyUrl", "privacy"], ["refundUrl", "refund"]] as const).filter(([k]) => legal[k]);
  if (identity.length === 0 && links.length === 0) return null;
  return (
    <footer className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs">
      {identity.length > 0 ? <p>{identity.join(" · ")}</p> : null}
      {links.length > 0 ? (
        <p className="flex flex-wrap gap-x-3">
          {links.map(([k, label]) => (
            <a key={k} href={legal[k]} target="_blank" rel="noopener" className="underline underline-offset-2">{t(label)}</a>
          ))}
        </p>
      ) : null}
    </footer>
  );
}
```

`channel-page.tsx`: after `<PublicLanguageLinks locale={locale} />` add `<LegalFooter legal={await getOrgLegal(org.orgId)} />` (the org id is in scope as `org.orgId`; import both).

- [ ] **Step 3: The manage page**

`STATUS_KEY` gains `pending_payment: "pendingPayment", expired: "expired"` — and rename the existing `public.manage.status.expired` ("Request expired") to `requestExpired` in en.json and in the page's `b.status === "pending" && !isInFuture ? t("status.expired")` branch (→ `t("status.requestExpired")`), so `status.expired` can mean the released hold.

`infoLines`: add `paidCents: b.paidCents, refundedCents: b.refundedCents, holding: b.status === "pending_payment"`.

After the `<h1>` block, banners from the query string (`sp.paid === "1"` / `sp.pay === "failed"`, first value if array — the page already reads `sp`):

```tsx
      {sp.paid === "1" && b.status === "confirmed" ? <p className="text-sm">{t("paymentReceived")}</p> : null}
      {sp.paid === "1" && b.status === "pending_payment" ? <p className="text-sm">{t("paymentProcessing")}</p> : null}
      {sp.pay === "failed" ? <p className="text-destructive text-sm">{t("paymentFailed")}</p> : null}
```

A `pending_payment` branch beside the `pending` one:

```tsx
      {b.status === "pending_payment" && isInFuture ? (
        <>
          <p className="text-muted-foreground text-sm">
            {b.holdExpiresAt && b.holdExpiresAt.getTime() > now
              ? t("reservedUntil", { until: formatUntil(b.holdExpiresAt, b.orgTimezone, INTL_LOCALES[locale]) })
              : t("holdLapsed")}
          </p>
          {b.holdExpiresAt && b.holdExpiresAt.getTime() > now ? (
            <a className={cn(buttonVariants({ variant: "brand" }), "h-9 self-start px-3.5")} href={`/booking/${token}/pay?lang=${locale}`}>
              {b.depositCents !== null && b.currency ? tConfirmed("pay", { amount: formatMoney(b.depositCents, b.currency) }) : tConfirmed("pay", { amount: "" })}
            </a>
          ) : null}
          <ManageBooking token={token} timeZone={b.orgTimezone} canReschedule={false} canCancel={true} kind="rental" rangeMode={b.rangeMode} request />
        </>
      ) : null}
      {b.status === "expired" ? <p className="text-muted-foreground text-sm">{t("expiredBody")}</p> : null}
```

(imports: `formatUntil` from templates, `formatMoney` from `@/lib/money`.) After `<PublicLanguageLinks locale={locale} />`: `<LegalFooter legal={await getOrgLegal(b.orgId)} />`.

`messages/en.json` → `public.manage`:

```json
    "status": { "...": "...", "requestExpired": "Request expired", "pendingPayment": "Awaiting payment", "expired": "Released — the deposit wasn't paid in time" },
    "reservedUntil": "Reserved until {until}. Pay the deposit to confirm.",
    "holdLapsed": "The payment window has passed. This time will be released shortly — book again to reserve it.",
    "paymentReceived": "Payment received — thank you.",
    "paymentProcessing": "We're confirming your payment — this page updates once your bank settles it.",
    "paymentFailed": "Payment isn't available right now — try again in a moment.",
    "expiredBody": "This reservation was released because the deposit wasn't paid in time. You can book again on the studio's page."
```

and a new `public.legal`:

```json
    "legal": { "taxId": "NIP {id}", "regNo": "Reg. no. {id}", "terms": "Terms", "privacy": "Privacy", "refund": "Refund policy" }
```

- [ ] **Step 4: Run**

Run: `npm run typecheck && npm run lint`; dev app: book a held slot → open View reservation → "Reserved until …" + Pay button → fake checkout Pay → back on the page with "Payment received" and "Paid 50 zł · 50 zł due at the venue"; fill legal details on /payments → the footer shows on the booking page and the manage page.
Expected: clean; flows as described.

- [ ] **Step 5: Commit**

```bash
git add "src/app/booking/[token]/page.tsx" src/lib/booking/public.ts src/features/booking-page/render messages/en.json
git commit -m "feat(public): manage page hold/paid/released states, legal footer (S2)"
```

### Task 11: Ukrainian and Polish strings, glossary

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json` (every key Tasks 3–10 added to `en.json`), `messages/GLOSSARY.md`
- Test: `src/i18n/messages.test.ts` (exists — parity + forbidden words)

- [ ] **Step 1: Run the parity test to see the gap**

Run: `npx vitest run src/i18n/messages.test.ts`
Expected: FAIL listing the missing uk/pl keys (`public.units.payNow…`, `public.confirmed.reservedUntil…`, `public.manage.*`, `public.legal.*`, `emails.paymentDue/paymentReceived/holdExpired/slotLost`, `bookings.status.pendingPayment/expired`, `bookings.hold.*`, `bookings.markPaid.*`, `bookings.cancel.refund*`, `errors.bookings.notHeld`, `payments.*`, `shell.nav.payments`).

- [ ] **Step 2: Add the Polish strings** (Polish is the launch language — D1; a native speaker reads these):

```json
"public.units": { "payNow": "Zapłać {amount} teraz, aby potwierdzić", "paid": "Zapłacono: {amount}", "balanceAtVenue": "{amount} do zapłaty na miejscu", "refund": "Zwrócono: {amount} — zwrot na konto trwa do 3 dni roboczych" },
"public.confirmed": { "reservedUntil": "Zarezerwowano do {until}", "payBody": "Zapłać {amount}, aby potwierdzić. Nieopłacone rezerwacje są zwalniane automatycznie.", "pay": "Zapłać {amount}", "viewReservation": "Zobacz rezerwację" },
"public.manage": {
  "status": { "requestExpired": "Prośba wygasła", "pendingPayment": "Oczekuje na płatność", "expired": "Zwolniono — zaliczka nie została opłacona w terminie" },
  "reservedUntil": "Zarezerwowano do {until}. Zapłać zaliczkę, aby potwierdzić.",
  "holdLapsed": "Czas na płatność minął. Termin zostanie wkrótce zwolniony — zarezerwuj ponownie.",
  "paymentReceived": "Płatność otrzymana — dziękujemy.",
  "paymentProcessing": "Potwierdzamy Twoją płatność — ta strona zaktualizuje się, gdy bank ją rozliczy.",
  "paymentFailed": "Płatność jest chwilowo niedostępna — spróbuj ponownie za chwilę.",
  "expiredBody": "Rezerwacja została zwolniona, ponieważ zaliczka nie została opłacona w terminie. Możesz zarezerwować ponownie na stronie studia."
},
"public.legal": { "taxId": "NIP {id}", "regNo": "Nr rej. {id}", "terms": "Regulamin", "privacy": "Polityka prywatności", "refund": "Zasady zwrotów" },
"emails": {
  "paymentDue": { "subject": "Zapłać {amount} do {until}, aby potwierdzić — {service}, {when}", "lead": "Termin jest zarezerwowany do {until}. Zapłać zaliczkę, aby go potwierdzić — nieopłacone rezerwacje są zwalniane automatycznie.", "pay": "Zapłać {amount}", "payText": "Zapłać {amount}: {url}", "keep": "Zachowaj tę wiadomość — powyższe linki to Twój dostęp do rezerwacji." },
  "paymentReceived": { "subject": "Płatność otrzymana — {service}, {when}", "lead": "Dziękujemy — otrzymaliśmy Twoją płatność, rezerwacja jest potwierdzona.", "manageHint": "Aby ją zobaczyć lub zmienić, użyj linku z wiadomości o rezerwacji." },
  "holdExpired": { "subject": "Rezerwacja zwolniona — {service}, {when}", "lead": "Zaliczka za tę rezerwację nie wpłynęła w terminie, więc termin został zwolniony.", "bookAgain": "Zarezerwuj ponownie", "bookAgainText": "Zarezerwuj ponownie: {url}" },
  "slotLost": { "subject": "Nie udało się potwierdzić {service}, {when}", "lead": "Twoja płatność dotarła po zwolnieniu rezerwacji, a termin został w międzyczasie zajęty. {amount} zostanie Ci zwrócone — zwrot na konto trwa do 3 dni roboczych." }
},
"bookings": {
  "status": { "pendingPayment": "Oczekuje na płatność", "expired": "Zwolniono — nieopłacone" },
  "hold": { "until": "Zarezerwowano do {time}", "lapsed": "Czas na płatność minął — najbliższy przebieg zwolni ten termin.", "paid": "Zapłacono {paid}", "paidBalance": "Zapłacono {paid} · {balance} do zapłaty na miejscu", "refunded": "Zwrócono {amount}" },
  "markPaid": { "button": "Oznacz jako opłacone", "done": "Oznaczono jako opłacone — klient otrzymał e-mail." },
  "cancel": { "refund": "Zwróć {amount}", "refundFailed": "Zwrot się nie powiódł — wykonaj go w Stripe." }
},
"errors.bookings": { "notHeld": "Ta rezerwacja nie oczekuje już na płatność." },
"shell.nav": { "payments": "Płatności" },
"payments": {
  "intro": "Jak klienci płacą zaliczki i jakie dane firmy pokazuje Twoja strona rezerwacji.",
  "stripe": {
    "title": "Stripe", "blurb": "Zaliczki są płacone przez Stripe na Twoje własne konto — Booklo nie przechowuje pieniędzy i nie pobiera prowizji.",
    "notConfigured": "Płatności nie są skonfigurowane na tym serwerze.",
    "notConnected": "Połącz Stripe, aby pobierać zaliczki online. Rezerwacje wymagające zaliczki są wstrzymane do jej opłacenia.",
    "country": "Kraj firmy", "connect": "Połącz Stripe", "continue": "Kontynuuj konfigurację",
    "onboarding": "Stripe potrzebuje jeszcze kilku danych, zanim będziesz mógł przyjmować płatności.",
    "active": "Aktywne — klienci mogą płacić zaliczki online.",
    "restricted": "Stripe wstrzymał płatności na tym koncie i potrzebuje dodatkowych informacji.",
    "openDashboard": "Otwórz panel Stripe",
    "capability": { "card_payments": "Karty", "p24_payments": "Przelewy24", "blik_payments": "BLIK" },
    "notice": { "return": "Dane Stripe zapisane.", "returnIncomplete": "Stripe potrzebuje jeszcze kilku danych — dokończ konfigurację, gdy będziesz gotowy.", "error": "Nie udało się połączyć ze Stripe. Spróbuj ponownie za chwilę." }
  },
  "hold": { "title": "Czas na płatność", "blurb": "Jak długo rezerwacja czeka na zaliczkę. Nieopłacone rezerwacje są zwalniane automatycznie.", "label": "Wstrzymaj przez", "options": { "30": "30 minut", "60": "1 godzinę", "180": "3 godziny", "1440": "24 godziny" } },
  "legal": { "title": "Dane firmy", "blurb": "Widoczne w stopce Twojej strony rezerwacji. Przelewy24 wymaga ich do płatności online.", "legalName": "Nazwa firmy", "address": "Adres", "taxId": "NIP", "regNo": "REGON lub KRS", "termsUrl": "Link do regulaminu", "privacyUrl": "Link do polityki prywatności", "refundUrl": "Link do zasad zwrotów" },
  "save": "Zapisz", "saved": "Zapisano"
}
```

- [ ] **Step 3: Add the Ukrainian strings** — the same keys:

```json
"public.units": { "payNow": "Сплатіть {amount} зараз, щоб підтвердити", "paid": "Сплачено: {amount}", "balanceAtVenue": "{amount} до сплати на місці", "refund": "Повернено: {amount} — повернення на рахунок триває до 3 робочих днів" },
"public.confirmed": { "reservedUntil": "Заброньовано до {until}", "payBody": "Сплатіть {amount}, щоб підтвердити. Неоплачені бронювання звільняються автоматично.", "pay": "Сплатити {amount}", "viewReservation": "Переглянути бронювання" },
"public.manage": {
  "status": { "requestExpired": "Запит прострочено", "pendingPayment": "Очікує оплати", "expired": "Звільнено — передоплату не внесено вчасно" },
  "reservedUntil": "Заброньовано до {until}. Сплатіть передоплату, щоб підтвердити.",
  "holdLapsed": "Час на оплату минув. Цей час незабаром звільниться — забронюйте знову.",
  "paymentReceived": "Оплату отримано — дякуємо.",
  "paymentProcessing": "Підтверджуємо вашу оплату — сторінка оновиться, щойно банк її проведе.",
  "paymentFailed": "Оплата зараз недоступна — спробуйте ще раз за хвилину.",
  "expiredBody": "Бронювання звільнено, бо передоплату не внесено вчасно. Ви можете забронювати знову на сторінці студії."
},
"public.legal": { "taxId": "NIP {id}", "regNo": "Реєстр. № {id}", "terms": "Правила", "privacy": "Конфіденційність", "refund": "Умови повернення" },
"emails": {
  "paymentDue": { "subject": "Сплатіть {amount} до {until}, щоб підтвердити — {service}, {when}", "lead": "Час заброньовано до {until}. Сплатіть передоплату, щоб підтвердити — неоплачені бронювання звільняються автоматично.", "pay": "Сплатити {amount}", "payText": "Сплатити {amount}: {url}", "keep": "Збережіть цей лист — посилання вище дають доступ до бронювання." },
  "paymentReceived": { "subject": "Оплату отримано — {service}, {when}", "lead": "Дякуємо — оплату отримано, бронювання підтверджено.", "manageHint": "Щоб переглянути чи змінити його, скористайтеся посиланням із листа про бронювання." },
  "holdExpired": { "subject": "Бронювання звільнено — {service}, {when}", "lead": "Передоплату за це бронювання не отримано вчасно, тож час звільнено.", "bookAgain": "Забронювати знову", "bookAgainText": "Забронювати знову: {url}" },
  "slotLost": { "subject": "Не вдалося підтвердити {service}, {when}", "lead": "Ваша оплата надійшла після того, як бронювання було звільнено, і час тим часом зайняли. {amount} буде повернено — повернення на рахунок триває до 3 робочих днів." }
},
"bookings": {
  "status": { "pendingPayment": "Очікує оплати", "expired": "Звільнено — не оплачено" },
  "hold": { "until": "Заброньовано до {time}", "lapsed": "Час на оплату минув — наступний прохід звільнить цей час.", "paid": "Сплачено {paid}", "paidBalance": "Сплачено {paid} · {balance} до сплати на місці", "refunded": "Повернено {amount}" },
  "markPaid": { "button": "Позначити як оплачене", "done": "Позначено як оплачене — клієнту надіслано лист." },
  "cancel": { "refund": "Повернути {amount}", "refundFailed": "Повернення не вдалося — виконайте його у Stripe." }
},
"errors.bookings": { "notHeld": "Це бронювання вже не очікує оплати." },
"shell.nav": { "payments": "Платежі" },
"payments": {
  "intro": "Як клієнти сплачують передоплату та які дані бізнесу показує ваша сторінка бронювання.",
  "stripe": {
    "title": "Stripe", "blurb": "Передоплати надходять через Stripe на ваш власний рахунок — Booklo не тримає гроші й не бере комісії.",
    "notConfigured": "Платежі не налаштовано на цьому сервері.",
    "notConnected": "Підключіть Stripe, щоб приймати передоплати онлайн. Бронювання з передоплатою утримуються до її сплати.",
    "country": "Країна бізнесу", "connect": "Підключити Stripe", "continue": "Продовжити налаштування",
    "onboarding": "Stripe потребує ще кількох даних, перш ніж ви зможете приймати платежі.",
    "active": "Активно — клієнти можуть сплачувати передоплату онлайн.",
    "restricted": "Stripe призупинив платежі на цьому рахунку й потребує додаткової інформації.",
    "openDashboard": "Відкрити панель Stripe",
    "capability": { "card_payments": "Картки", "p24_payments": "Przelewy24", "blik_payments": "BLIK" },
    "notice": { "return": "Дані Stripe збережено.", "returnIncomplete": "Stripe потребує ще кількох даних — завершіть налаштування, коли будете готові.", "error": "Не вдалося зв'язатися зі Stripe. Спробуйте ще раз за хвилину." }
  },
  "hold": { "title": "Час на оплату", "blurb": "Скільки бронювання чекає на передоплату. Неоплачені бронювання звільняються автоматично.", "label": "Утримувати", "options": { "30": "30 хвилин", "60": "1 годину", "180": "3 години", "1440": "24 години" } },
  "legal": { "title": "Дані бізнесу", "blurb": "Показуються в нижній частині вашої сторінки бронювання. Przelewy24 вимагає їх для онлайн-платежів.", "legalName": "Юридична назва", "address": "Адреса", "taxId": "NIP", "regNo": "REGON або KRS", "termsUrl": "Посилання на правила", "privacyUrl": "Посилання на політику конфіденційності", "refundUrl": "Посилання на умови повернення" },
  "save": "Зберегти", "saved": "Збережено"
}
```

Place each fragment under its namespace in the same position as in `en.json`. `messages/GLOSSARY.md`: add rows for *hold / reservation* (pl "rezerwacja wstrzymana", uk "утримане бронювання"), *deposit* (pl "zaliczka", uk "передоплата"), *refund* (pl "zwrot", uk "повернення") — check the table's existing columns and match them.

- [ ] **Step 4: Run**

Run: `npx vitest run src/i18n && npm run lint`
Expected: PASS (parity, forbidden words, ICU shapes).

- [ ] **Step 5: Commit**

```bash
git add messages
git commit -m "i18n: Polish and Ukrainian strings for holds, payments and the legal footer (S2)"
```

### Task 12: Full verify, end-to-end QA (fake, then Stripe test mode), merge main, PR

**Files:**
- Modify: `docs/runbook-production.md` (env keys + the Connect webhook endpoint + one-window deploy note), `.env.example`
- Create: `scripts/qa-s2-holds.ts` (optional scripted Playwright walk — the S1 lesson: the MCP browser may be locked; `npx playwright` from the npm cache works)

- [ ] **Step 1: Full verify**

Run: `npm run verify && npm run test:integration`
Expected: all green (1265+ unit, 400+ integration). Fix anything that fails in the task that owns it, then re-run.

- [ ] **Step 2: Fake-provider walk at localhost** (`PAYMENTS_PROVIDER=fake`, `PAYMENTS_FAKE_SECRET` set, dev server at `http://localhost:3000` — never 127.0.0.1)

1. /payments → Connect Stripe (country PL) → toast, card Active with three chips. Set hold 30 min, NIP + Terms link → Save.
2. Space with `price 100 zł/h, deposit 50 %` (Spaces → the space → Prices & terms). Book 1 h from `/<handle>` → panel "Reserved until …" with **Pay 50 zł** and View reservation; the mail log shows "Pay 50 zł by …" with `/pay`; Bookings shows a dashed card "Awaiting payment".
3. Pay → fake Checkout → **Pay** → manage page "Payment received", money lines "Paid: 50 zł / 50 zł due at the venue"; provider notice mail arrived; Bookings card solid.
4. Book again → Pay → **Pay later (async)** → manage page "confirming" then confirmed on reload. Book again → **Fail** → still held; Pay again works.
5. Book again; in psql set `hold_expires_at = now() - interval '1 minute'`; `curl -X POST -H "Authorization: Bearer $SCHEDULING_DRAIN_SECRET" localhost:3000/api/scheduling/drain` → `holds.expired ≥ 1`; manage page "Released"; "Reservation released" mail; the slot is free again on the public page.
6. Approval + deposit: set `requires_approval` on the space → book → request → Accept → the client mail is "Pay 50 zł by …" and the row is "Awaiting payment"; Mark as paid → confirmed + "Marked as paid" mail.
7. Paid booking → client manage page → Cancel (outside window) → "Refunded: 50 zł" in the cancelled mail; admin detail shows "Refunded 50 zł". Admin cancel of another paid booking with the checkbox off → no refund line.
8. Legal footer visible on `/<handle>` and on a manage page; absent on an org with empty legal.

- [ ] **Step 3: Stripe test mode** (real rail; `PAYMENTS_PROVIDER=stripe`, a test-mode `STRIPE_CONNECT_SECRET_KEY` from the Connect platform account, `stripe listen --forward-connect-to localhost:3000/api/payments/webhook` → its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`)

1. /payments → Connect Stripe → Stripe-hosted onboarding for a PL test business (use Stripe's test identity data; MCC 7333 is pre-set — note whether Stripe asks for more). Return → card Active once `card_payments` is active (P24/BLIK may stay pending in test mode — record it).
2. Book a held slot → Pay → the studio-branded Checkout shows P24 / BLIK / card (whichever the test account has enabled) → pay with `4242 4242 4242 4242` → webhook `checkout.session.completed` → confirmed. Pay with the P24 test flow → `completed` (unpaid) then `async_payment_succeeded` → confirmed.
3. Let a hold lapse → drain → Stripe dashboard shows the session expired.
4. Cancel a paid booking outside the window → a refund appears on the connected account.
5. Record every deviation from the plan in the PR body (capability review outcomes, MCC prompts, dashboard type behaviour).

- [ ] **Step 4: Runbook + env example**

`docs/runbook-production.md`: a "Payments (S2)" section — the four env keys; the Connect webhook endpoint (platform account → Developers → Webhooks → "Listen to events on connected accounts", events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`); the one-window deploy note for 0079; the launch-checklist items from the spec's last section.

- [ ] **Step 5: Merge main, final review, PR**

```bash
git fetch origin && git merge origin/main   # resolve; re-run npm run verify
git push -u origin feat/s2-holds-collection
gh pr create --title "feat(payments): holds + collection — Stripe Connect direct charges, pending_payment, refunds, legal footer (S2)" --body-file /tmp/pr-body.md
```

PR body: what shipped (spec link), migration 0079 + the one-window deploy note, rulings 1–9 from the spec, deviations found in QA, the deferred list (S3 tiers/partial refunds, S7 balance links, S4 daily list, account webhooks, express dashboard), the QA log from Steps 2–3, and the trailer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
```
