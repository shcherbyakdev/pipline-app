/**
 * S2 Connect webhook end to end against the local stack: a signed batch of
 * provider events → applyPaymentEvents → the RPC / the ledger. Only the
 * outward edges are stubbed (mail transport, push) — the database is real,
 * so every outcome string here is the one Postgres actually returned.
 *
 * Import order matters: `@/env` parses process.env at module load, so the
 * payments vars are set BEFORE the dynamic imports below (the
 * api/billing/webhook test's idiom).
 */
import { describe, it, expect, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Nothing leaves the process: sendPaymentReceived's client mail and
// notifyMembers' provider mail both resolve their transport through here.
const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/email/transport", () => ({
  selectTransport: () => ({
    send: async (msg: Record<string, unknown>) => {
      mail.sent.push(msg);
    },
  }),
}));
// Web Push is unconfigured here; stub it so the notice seam stays silent.
vi.mock("@/features/notifications/push", () => ({
  sendPush: async () => undefined,
}));

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.PAYMENTS_PROVIDER = "fake";
process.env.PAYMENTS_FAKE_SECRET = "test-secret-0123456789abcdef";

const { POST } = await import("./route");
const { signFakePaymentsWebhook } = await import("@/lib/payments/fake");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
const DAY = "2027-06-14";
let counter = 0;

// ---------- seeding (holds.integration.test.ts's helpers, which are local
// to that file — the two suites seed the same shape).

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `wh_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
    p_name: `S2 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s2wh-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Flat 100 zł/h, 50 % deposit (H3) → every booking below owes 5000 cents. */
async function hoursFixture(client: SupabaseClient, orgId: string) {
  const { data: off, error: e1 } = await client
    .from("rental_offerings")
    .insert({
      org_id: orgId,
      name: "Studio",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
      turnover_min: 0,
      min_notice_min: 0,
      booking_window_days: 730,
      unit_selection: "auto",
      active: true,
      price_cents: 10000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 50,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e2) throw e2;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e3 } = await client.from("availability_rules").insert(rules);
  if (e3) throw e3;
  return { offeringId: off!.id as string };
}

async function activeAccount(orgId: string) {
  const { error } = await admin.from("payment_accounts").insert({
    org_id: orgId,
    stripe_account_id: `acct_wh_${orgId.slice(0, 8)}_${counter++}`,
    status: "active",
  });
  if (error) throw error;
}

async function createHours(handle: string, offeringId: string, hour: number) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, TZ).toISOString(),
    p_duration_min: 60,
    p_name: "Ola",
    p_email: `ola${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return { id: data as string };
}

/** The row startCheckout would have written, minus the provider round-trip. */
async function ledger(bookingId: string, sessionId: string) {
  const { data: b } = await admin.from("bookings").select("org_id").eq("id", bookingId).single();
  const { data, error } = await admin
    .from("booking_payments")
    .insert({
      org_id: b!.org_id,
      booking_id: bookingId,
      kind: "deposit",
      provider: "fake",
      amount_cents: 5000,
      currency: "PLN",
      status: "pending",
      checkout_session_id: sessionId,
      stripe_account_id: "acct_fake_x",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

function post(events: unknown[]) {
  const body = JSON.stringify(events);
  return POST(
    new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      body,
      headers: { "x-signature": signFakePaymentsWebhook(body, process.env.PAYMENTS_FAKE_SECRET!) },
    }),
  );
}

describe("POST /api/payments/webhook (fake provider)", () => {
  it("rejects a bad signature", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "[]", headers: { "x-signature": "nope" } }),
    );
    expect(res.status).toBe(401);
  });

  it("completed+paid confirms the hold and reports it", async () => {
    const { client, orgId, handle } = await newOrg("wh");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id, "cs_wh_" + id);
    const res = await post([
      {
        type: "checkout.completed",
        sessionId: "cs_wh_" + id,
        paymentIntentId: "pi_wh",
        amountCents: 5000,
        paid: true,
        accountId: "acct_fake_x",
      },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, outcomes: ["confirmed"] });
    const { data: b } = await admin.from("bookings").select("status, paid_cents").eq("id", id).single();
    expect(b).toEqual({ status: "confirmed", paid_cents: 5000 });
    // The confirmation side-effects ran: the client's receipt + the provider's notice.
    expect(mail.sent.length).toBeGreaterThanOrEqual(2);
  });

  it("completed+unpaid marks processing and extends the hold by an hour", async () => {
    const { client, orgId, handle } = await newOrg("async");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id, "cs_as_" + id);
    const before = (await admin.from("bookings").select("hold_expires_at").eq("id", id).single()).data!
      .hold_expires_at as string;
    await post([
      {
        type: "checkout.completed",
        sessionId: "cs_as_" + id,
        paymentIntentId: "pi_as",
        amountCents: 5000,
        paid: false,
        accountId: "acct_fake_x",
      },
    ]);
    const after = (await admin.from("bookings").select("status, hold_expires_at").eq("id", id).single()).data!;
    expect(after.status).toBe("pending_payment");
    expect(new Date(after.hold_expires_at as string).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(
      (await admin.from("booking_payments").select("status").eq("checkout_session_id", "cs_as_" + id).single()).data!
        .status,
    ).toBe("processing");
    await post([
      {
        type: "checkout.async_succeeded",
        sessionId: "cs_as_" + id,
        paymentIntentId: "pi_as",
        amountCents: 5000,
        paid: true,
        accountId: "acct_fake_x",
      },
    ]);
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe("confirmed");
  });

  it("async_failed / expired only touch the ledger; unknown session is a 200 no-op", async () => {
    const { client, orgId, handle } = await newOrg("fail");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id, "cs_f_" + id);
    await post([
      {
        type: "checkout.async_failed",
        sessionId: "cs_f_" + id,
        paymentIntentId: null,
        amountCents: null,
        paid: false,
        accountId: "acct_fake_x",
      },
    ]);
    expect(
      (await admin.from("booking_payments").select("status").eq("checkout_session_id", "cs_f_" + id).single()).data!
        .status,
    ).toBe("failed");
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe("pending_payment");
    const res = await post([
      {
        type: "checkout.expired",
        sessionId: "cs_none",
        paymentIntentId: null,
        amountCents: null,
        paid: false,
        accountId: null,
      },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcomes: ["unknown"] });
  });

  it("slot_lost refunds and marks the ledger refunded", async () => {
    const { client, orgId, handle } = await newOrg("lostwh");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("bookings").update({ status: "expired" }).eq("id", id);
    await createHours(handle, offeringId, 10); // someone else took it
    await ledger(id, "cs_l_" + id);
    const res = await post([
      {
        type: "checkout.completed",
        sessionId: "cs_l_" + id,
        paymentIntentId: "pi_l",
        amountCents: 5000,
        paid: true,
        accountId: "acct_fake_x",
      },
    ]);
    expect(await res.json()).toMatchObject({ outcomes: ["slot_lost"] });
    const { data: row } = await admin
      .from("booking_payments")
      .select("status, refunded_cents, refund_id")
      .eq("checkout_session_id", "cs_l_" + id)
      .single();
    expect(row).toMatchObject({ status: "refunded", refunded_cents: 5000 });
    expect(row!.refund_id).toMatch(/^re_fake_/);
    // The BOOKING never counted this payment as paid (the confirm was rolled
    // back by the EXCLUDE guard), so bump_booking_refunded clamps to 0 — the
    // ledger row is the record of what actually went back.
    expect((await admin.from("bookings").select("refunded_cents").eq("id", id).single()).data!.refunded_cents).toBe(0);
  });

  it("bump_booking_refunded is exact under paid_cents and clamps above it", async () => {
    const { client, orgId, handle } = await newOrg("bump");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await ledger(id, "cs_b_" + id);
    await post([
      {
        type: "checkout.completed",
        sessionId: "cs_b_" + id,
        paymentIntentId: "pi_b",
        amountCents: 5000,
        paid: true,
        accountId: "acct_fake_x",
      },
    ]);
    const refunded = async () =>
      (await admin.from("bookings").select("refunded_cents").eq("id", id).single()).data!.refunded_cents;

    const partial = await admin.rpc("bump_booking_refunded", { p_booking_id: id, p_cents: 2000 });
    expect(partial.error).toBeNull();
    expect(await refunded()).toBe(2000);

    // Never above what the booking took: bookings_refunded_ck would raise.
    const over = await admin.rpc("bump_booking_refunded", { p_booking_id: id, p_cents: 9000 });
    expect(over.error).toBeNull();
    expect(await refunded()).toBe(5000);
  });
});
