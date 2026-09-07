/**
 * S2 refunds against the local stack: refundBooking gives back every paid
 * ledger row in full, bumps the booking, is idempotent on a second pass, and
 * records a provider refusal on the row instead of throwing. Requires
 * `supabase start`.
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { refundBooking } = await import("./refund");
const { expireOpenCheckouts } = await import("./checkout");
const { fakePaymentsProvider } = await import("@/lib/payments/fake");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
const DAY = "2027-08-16";
let counter = 0;

// ---------- seeding (holds.integration.test.ts's helpers, which are local
// to that file — the two suites seed the same shape).

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rf_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
  const handle = `s2rf-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

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
    stripe_account_id: `acct_test_${orgId.slice(0, 8)}_${counter++}`,
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

/** A confirmed booking whose 5000-cent deposit is paid through the RPC. */
async function paidBooking(tag: string, session: string) {
  const { client, orgId, handle } = await newOrg(tag);
  const { offeringId } = await hoursFixture(client, orgId);
  await activeAccount(orgId);
  const { id } = await createHours(handle, offeringId, 10);
  const { error } = await admin.from("booking_payments").insert({
    org_id: orgId,
    booking_id: id,
    kind: "deposit",
    provider: "fake",
    amount_cents: 5000,
    currency: "PLN",
    status: "pending",
    checkout_session_id: `${session}_${id}`,
    stripe_account_id: "acct_fake_x",
  });
  if (error) throw error;
  const { error: applyError } = await admin.rpc("apply_booking_payment", {
    p_session_id: `${session}_${id}`,
    p_payment_intent_id: `pi_${session}`,
    p_amount_cents: 5000,
  });
  if (applyError) throw applyError;
  return { id, session: `${session}_${id}` };
}

describe("refundBooking", () => {
  it("refunds every paid row in full and bumps the booking", async () => {
    const { id } = await paidBooking("ref", "cs_r");
    const r = await refundBooking(id, "cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(r).toEqual({ refundedCents: 5000, failed: false });
    const { data: b } = await admin
      .from("bookings")
      .select("paid_cents, refunded_cents")
      .eq("id", id)
      .single();
    expect(b).toEqual({ paid_cents: 5000, refunded_cents: 5000 });
    const again = await refundBooking(id, "cancel", {
      db: admin,
      provider: fakePaymentsProvider(),
    });
    expect(again).toEqual({ refundedCents: 0, failed: false });
  });

  it("skips a manual (cash) paid row: nothing refunded, nothing failed, row untouched", async () => {
    const { client, orgId, handle } = await newOrg("manual");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    // mark_booking_paid writes provider 'manual' with no payment intent —
    // money the provider never took.
    const { error } = await client.rpc("mark_booking_paid", { p_booking_id: id });
    if (error) throw error;
    const r = await refundBooking(id, "cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(r).toEqual({ refundedCents: 0, failed: false });
    const { data: row } = await admin
      .from("booking_payments")
      .select("provider, status")
      .eq("booking_id", id)
      .single();
    expect(row).toEqual({ provider: "manual", status: "paid" });
    expect(
      (await admin.from("bookings").select("refunded_cents").eq("id", id).single()).data!
        .refunded_cents,
    ).toBe(0);
  });

  it("a provider failure leaves refund_failed + error, never throws", async () => {
    const { id, session } = await paidBooking("reffail", "cs_rf");
    const broken = {
      ...fakePaymentsProvider(),
      refund: async () => {
        throw new Error("stripe down");
      },
    };
    const r = await refundBooking(id, "cancel", { db: admin, provider: broken });
    expect(r).toEqual({ refundedCents: 0, failed: true });
    const { data: row } = await admin
      .from("booking_payments")
      .select("status, error")
      .eq("checkout_session_id", session)
      .single();
    expect(row).toMatchObject({ status: "refund_failed", error: "stripe down" });
  });

  it("caps at amountCents across rows: the first row empties, the second stays paid", async () => {
    const { id } = await paidBooking("cap", "cs_cap"); // row A: 5000, paid_cents 5000
    const { data: b0 } = await admin.from("bookings").select("org_id").eq("id", id).single();
    // Row B: a second 2000 payment on the same booking. apply_booking_payment
    // only confirms a pending_payment/expired hold; this booking is already
    // confirmed, so the RPC would flip the ledger row to paid but return
    // slot_lost and never bump bookings.paid_cents. Insert the row already
    // `paid` and bump paid_cents directly instead (no bump_booking_paid RPC exists).
    const { error } = await admin.from("booking_payments").insert({
      org_id: b0!.org_id,
      booking_id: id,
      kind: "deposit",
      provider: "fake",
      amount_cents: 2000,
      currency: "PLN",
      status: "paid",
      checkout_session_id: `cs_cap2_${id}`,
      stripe_account_id: "acct_fake_x",
      payment_intent_id: "pi_cap2",
      paid_at: new Date().toISOString(),
    });
    if (error) throw error;
    const { error: bumpError } = await admin
      .from("bookings")
      .update({ paid_cents: 7000 })
      .eq("id", id);
    if (bumpError) throw bumpError;

    const r = await refundBooking(
      id,
      "cancel",
      { db: admin, provider: fakePaymentsProvider() },
      { amountCents: 6000 },
    );
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
    const { data: b } = await admin
      .from("bookings")
      .select("paid_cents, refunded_cents")
      .eq("id", id)
      .single();
    expect(b).toEqual({ paid_cents: 7000, refunded_cents: 6000 });

    // The remainder can still go back later (a waived fee).
    const rest = await refundBooking(id, "admin-cancel", { db: admin, provider: fakePaymentsProvider() });
    expect(rest).toEqual({ refundedCents: 1000, failed: false });
    const { data: after } = await admin
      .from("booking_payments")
      .select("status")
      .eq("booking_id", id)
      .order("created_at");
    expect(after!.map((x) => x.status)).toEqual(["refunded", "refunded"]);
  });

  it("amountCents 0 refunds nothing and touches nothing", async () => {
    const { id } = await paidBooking("zero", "cs_zero");
    const r = await refundBooking(
      id,
      "cancel",
      { db: admin, provider: fakePaymentsProvider() },
      { amountCents: 0 },
    );
    expect(r).toEqual({ refundedCents: 0, failed: false });
    const { data: row } = await admin
      .from("booking_payments")
      .select("status, refunded_cents")
      .eq("booking_id", id)
      .single();
    expect(row).toEqual({ status: "paid", refunded_cents: 0 });
  });
});

describe("expireOpenCheckouts", () => {
  it("mark_booking_paid then the sweep: the open session's row becomes expired", async () => {
    const { client, orgId, handle } = await newOrg("expire");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    // The row startCheckout leaves behind: pending, with a live session.
    const { data: pending, error } = await admin
      .from("booking_payments")
      .insert({
        org_id: orgId,
        booking_id: id,
        kind: "deposit",
        provider: "fake",
        amount_cents: 5000,
        currency: "PLN",
        status: "pending",
        checkout_session_id: `cs_x_${id}`,
        stripe_account_id: "acct_fake_x",
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: paidError } = await client.rpc("mark_booking_paid", { p_booking_id: id });
    if (paidError) throw paidError;

    await expireOpenCheckouts(id, { db: admin, provider: fakePaymentsProvider() });
    const { data: row } = await admin
      .from("booking_payments")
      .select("status")
      .eq("id", pending!.id)
      .single();
    expect(row).toEqual({ status: "expired" });
    // The manual row mark_booking_paid wrote is untouched: it is not open.
    const { data: manual } = await admin
      .from("booking_payments")
      .select("status")
      .eq("booking_id", id)
      .eq("provider", "manual")
      .single();
    expect(manual).toEqual({ status: "paid" });
  });
});
