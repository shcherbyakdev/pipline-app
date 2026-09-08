/**
 * startCheckout against the local stack: only a live hold on an org with an
 * active account gets a session, and a second visit reuses the open one
 * rather than minting a rival (spec ruling 8 — the pay route is a GET, so a
 * refresh must not create a second Checkout).
 *
 * Dynamic imports: `@/env` parses process.env at module load, which happens
 * before the top-level loadEnvFile above would run.
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.PAYMENTS_PROVIDER = "fake";
process.env.PAYMENTS_FAKE_SECRET = "test-secret-0123456789abcdef";

const { startCheckout } = await import("./checkout");
const { fakePaymentsProvider } = await import("@/lib/payments/fake");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const provider = fakePaymentsProvider();
const TZ = "Europe/Warsaw";
const DAY = "2027-07-19";
let counter = 0;
const URLS = { successUrl: "http://localhost:3000/booking/x?paid=1", cancelUrl: "http://localhost:3000/booking/x", locale: "pl" };

async function newOrg(tag: string) {
  const email = `co_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error: e0 } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (e0) throw e0;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  const { data: org, error: e1 } = await client.rpc("create_org", {
    p_name: `S2 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s2co-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Flat 100 zł/h, 50 % deposit (H3) → the hold owes 5000 cents. */
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
  const { error: e3 } = await client.from("availability_rules").insert(
    Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId,
      rental_offering_id: off!.id,
      weekday,
      start_time: "00:00",
      end_time: "23:59",
    })),
  );
  if (e3) throw e3;
  return { offeringId: off!.id as string };
}

async function activeAccount(orgId: string) {
  const { error } = await admin
    .from("payment_accounts")
    .insert({ org_id: orgId, stripe_account_id: `acct_co_${orgId.slice(0, 8)}_${counter++}`, status: "active" });
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
  return data as string;
}

/** An org with an active account and one hold on it. */
async function held(tag: string) {
  const { client, orgId, handle } = await newOrg(tag);
  const { offeringId } = await hoursFixture(client, orgId);
  await activeAccount(orgId);
  return { client, orgId, id: await createHours(handle, offeringId, 10) };
}

describe("startCheckout", () => {
  it("opens one session for a live hold and reuses it on a second visit", async () => {
    const { id } = await held("ok");
    const first = await startCheckout(id, URLS, { db: admin, provider });
    expect(first).toHaveProperty("url");
    const { data: rows } = await admin
      .from("booking_payments")
      .select("status, amount_cents, currency, checkout_session_id, checkout_url, checkout_expires_at")
      .eq("booking_id", id);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ status: "pending", amount_cents: 5000, currency: "PLN" });
    expect(rows![0].checkout_session_id).toMatch(/^cs_fake_/);
    expect(rows![0].checkout_url).toBe((first as { url: string }).url);
    // Checkout outlives the hold's 60 min by Stripe's 30-minute floor.
    expect(new Date(rows![0].checkout_expires_at as string).getTime()).toBeGreaterThan(Date.now());

    const second = await startCheckout(id, URLS, { db: admin, provider });
    expect(second).toEqual(first);
    const { count } = await admin
      .from("booking_payments")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", id);
    expect(count).toBe(1);
  });

  it("refuses a booking with nothing due", async () => {
    const { orgId, id } = await held("states");
    // Nothing to pay for: a confirmed booking already settled in full.
    await admin
      .from("bookings")
      .update({ status: "confirmed", hold_expires_at: null, paid_cents: 10000 })
      .eq("id", id);
    expect(await startCheckout(id, URLS, { db: admin, provider })).toEqual({ error: "nothing_due" });
    expect(await startCheckout(crypto.randomUUID(), URLS, { db: admin, provider })).toEqual({ error: "nothing_due" });

    // A lapsed hold is a dead link, not a session.
    await admin
      .from("bookings")
      .update({ status: "pending_payment", hold_expires_at: new Date(Date.now() - 60_000).toISOString(), paid_cents: 0 })
      .eq("id", id);
    expect(await startCheckout(id, URLS, { db: admin, provider })).toEqual({ error: "expired" });

    // The account can be pulled after the hold was taken.
    await admin.from("payment_accounts").update({ status: "restricted" }).eq("org_id", orgId);
    await admin
      .from("bookings")
      .update({ hold_expires_at: new Date(Date.now() + 30 * 60_000).toISOString() })
      .eq("id", id);
    expect(await startCheckout(id, URLS, { db: admin, provider })).toEqual({ error: "no_account" });
    expect((await admin.from("booking_payments").select("id").eq("booking_id", id)).data).toEqual([]);
  });

  it("a confirmed booking pays its balance, and the two kinds never share a session", async () => {
    const { orgId, id } = await held("balance");
    // 100 zł booked, 30 zł taken → 70 zł outstanding (the fixture's price is 10000).
    await admin
      .from("bookings")
      .update({ status: "confirmed", hold_expires_at: null, paid_cents: 3000 })
      .eq("id", id);
    const balance = await startCheckout(id, URLS, { db: admin, provider });
    expect(balance).toHaveProperty("url");
    const { data: rows } = await admin
      .from("booking_payments")
      .select("kind, amount_cents, checkout_expires_at")
      .eq("booking_id", id)
      .eq("status", "pending");
    expect(rows).toHaveLength(1);
    expect(rows![0].kind).toBe("balance");
    expect(rows![0].amount_cents).toBe(7000);
    // A balance link lives a day, not the hold's few minutes.
    expect(new Date(rows![0].checkout_expires_at as string).getTime()).toBeGreaterThan(
      Date.now() + 23 * 3_600_000,
    );

    // A charge added after the link was sent changes what is owed: the open
    // session is for the OLD amount, so the next ask mints a fresh one.
    const { error: chargeError } = await admin.from("booking_charges").insert({
      org_id: orgId, booking_id: id, kind: "overtime", label: "Overtime", qty: 1, unit_cents: 2500, cents: 2500,
    });
    expect(chargeError).toBeNull();
    const bigger = await startCheckout(id, URLS, { db: admin, provider });
    expect(bigger).toHaveProperty("url");
    expect(bigger).not.toEqual(balance);
    const { data: balanceRows } = await admin
      .from("booking_payments")
      .select("amount_cents")
      .eq("booking_id", id)
      .eq("kind", "balance")
      .eq("status", "pending")
      .order("amount_cents");
    expect(balanceRows!.map((r) => r.amount_cents)).toEqual([7000, 9500]);

    // Back to a live hold: the open balance session is NOT this deposit's.
    await admin
      .from("bookings")
      .update({ status: "pending_payment", hold_expires_at: new Date(Date.now() + 30 * 60_000).toISOString() })
      .eq("id", id);
    const deposit = await startCheckout(id, URLS, { db: admin, provider });
    expect(deposit).toHaveProperty("url");
    expect(deposit).not.toEqual(balance);
    const { data: kinds } = await admin
      .from("booking_payments")
      .select("kind")
      .eq("booking_id", id)
      .eq("status", "pending");
    expect(kinds!.map((r) => r.kind).sort()).toEqual(["balance", "balance", "deposit"]);

    // Settled in full: nothing left to open a session for (12500 = the
    // 10000 booking plus the 2500 charge).
    await admin.from("bookings").update({ status: "confirmed", hold_expires_at: null, paid_cents: 12500 }).eq("id", id);
    await admin.from("booking_payments").update({ status: "expired" }).eq("booking_id", id);
    expect(await startCheckout(id, URLS, { db: admin, provider })).toEqual({ error: "nothing_due" });
  });
});
