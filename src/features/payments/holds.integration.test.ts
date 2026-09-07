/**
 * S2 holds: the create/accept RPCs decide confirmed | pending | pending_payment
 * from the org's payment account + the offering's deposit; a hold blocks the
 * slot under EXCLUDE; apply_booking_payment confirms atomically and
 * idempotently, revives an expired hold when the slot is still free, and
 * reports slot_lost otherwise; cancel/rotate accept holds; the resolver
 * returns the money columns. Requires the local Supabase stack.
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { wallTimeToUtc } from "@/features/scheduling/slots";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const TZ = "Europe/Warsaw";
const at = (local: string) => {
  const [d, t] = local.split("T");
  return wallTimeToUtc(d, t, TZ).toISOString();
};
type Row = Record<string, unknown>;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
  const handle = `s2-${tag.replace(/_/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours offering 30/60–240, one unit, open every day 00:00–23:59 (the 0026
    CHECK caps end_time at 23:59, so "all day" is that). Flat 100 zł/h with a
    50 % deposit (H3), so every booking below owes 5000 cents. */
async function hoursFixture(
  client: SupabaseClient,
  orgId: string,
  over: Record<string, unknown> = {},
) {
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
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { data: unit, error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 })
    .select("id")
    .single();
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
  return { offeringId: off!.id as string, unitId: unit!.id as string };
}

/** A day well inside the 730-day window, org-local. */
const DAY = "2027-05-10";
let counter = 0;
const slotAt = (hour: number) => at(`${DAY}T${String(hour).padStart(2, "0")}:00`);

async function activeAccount(orgId: string) {
  const { error } = await admin.from("payment_accounts").insert({
    org_id: orgId,
    stripe_account_id: `acct_test_${orgId.slice(0, 8)}_${counter++}`,
    status: "active",
  });
  if (error) throw error;
}

async function createHours(handle: string, offeringId: string, hour: number, over: Row = {}) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: slotAt(hour),
    p_duration_min: 60,
    p_name: "Ola",
    p_email: `ola${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
    ...over,
  });
  return { id: data as string | null, error, token: token.token };
}

async function booking(id: string) {
  const { data, error } = await admin
    .from("bookings")
    .select("status, hold_expires_at, paid_cents, refunded_cents, deposit_cents, starts_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as {
    status: string;
    hold_expires_at: string | null;
    paid_cents: number;
    refunded_cents: number;
    deposit_cents: number | null;
    starts_at: string;
  };
}

async function ledgerRow(bookingId: string, sessionId: string) {
  const orgId = (await admin.from("bookings").select("org_id").eq("id", bookingId).single()).data!
    .org_id;
  const { data, error } = await admin
    .from("booking_payments")
    .insert({
      org_id: orgId,
      booking_id: bookingId,
      kind: "deposit",
      provider: "fake",
      amount_cents: 5000,
      currency: "PLN",
      status: "pending",
      checkout_session_id: sessionId,
    })
    .select("id")
    .single();
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
    const { offeringId } = await hoursFixture(client, orgId, {
      deposit_type: "none",
      deposit_value: null,
    });
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
    const { error: e } = await client.rpc("update_org_payments", {
      p_org_id: orgId,
      p_hold_min: 30,
      p_legal: {},
    });
    expect(e).toBeNull();
    const before = Date.now();
    const { id } = await createHours(handle, offeringId, 10);
    const hold = new Date((await booking(id!)).hold_expires_at!).getTime();
    expect(hold).toBeGreaterThan(before + 29 * 60_000);
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
    const session = "cs_pay_1_" + id;
    await ledgerRow(id!, session);
    const { data: r1 } = await admin.rpc("apply_booking_payment", {
      p_session_id: session,
      p_payment_intent_id: "pi_1",
      p_amount_cents: 5000,
    });
    expect(r1).toBe("confirmed");
    const b = await booking(id!);
    expect(b.status).toBe("confirmed");
    expect(b.paid_cents).toBe(5000);
    const { data: r2 } = await admin.rpc("apply_booking_payment", {
      p_session_id: session,
      p_payment_intent_id: "pi_1",
      p_amount_cents: 5000,
    });
    expect(r2).toBe("replayed");
    expect((await booking(id!)).paid_cents).toBe(5000);
    const { data: row } = await admin
      .from("booking_payments")
      .select("status, payment_intent_id, paid_at")
      .eq("checkout_session_id", session)
      .single();
    expect(row).toMatchObject({ status: "paid", payment_intent_id: "pi_1" });
    expect(row!.paid_at).not.toBeNull();
  });

  it("unknown session → unknown", async () => {
    const { data } = await admin.rpc("apply_booking_payment", {
      p_session_id: "cs_nope",
      p_payment_intent_id: "pi",
      p_amount_cents: 1,
    });
    expect(data).toBe("unknown");
  });

  it("revives an expired hold whose slot is still free", async () => {
    const { client, orgId, handle } = await newOrg("revive");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await admin.from("bookings").update({ status: "expired" }).eq("id", id!);
    const session = "cs_rev_" + id;
    await ledgerRow(id!, session);
    const { data } = await admin.rpc("apply_booking_payment", {
      p_session_id: session,
      p_payment_intent_id: "pi_r",
      p_amount_cents: 5000,
    });
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
    const session = "cs_lost_" + id;
    await ledgerRow(id!, session);
    const { data } = await admin.rpc("apply_booking_payment", {
      p_session_id: session,
      p_payment_intent_id: "pi_l",
      p_amount_cents: 5000,
    });
    expect(data).toBe("slot_lost");
    expect((await booking(id!)).status).toBe("expired");
    const { data: row } = await admin
      .from("booking_payments")
      .select("status")
      .eq("checkout_session_id", session)
      .single();
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
    const { error: rotErr } = await client.rpc("rotate_booking_token", {
      p_booking_id: id,
      p_token_hash: fresh.tokenHash,
    });
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
    const { id } = await createHours(handle, offeringId, 10);
    const fresh = generateAccessToken();
    // reschedule_rental_hours_apply holds EXECUTE for no role (0056); the
    // admin wrapper is the only way in.
    const { error } = await client.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: id,
      p_unit_id: null,
      p_starts_at: slotAt(14),
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("a reschedule carries paid money and re-points the ledger to the new row", async () => {
    const { client, orgId, handle } = await newOrg("carry");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const session = "cs_carry_" + id;
    await ledgerRow(id!, session);
    await admin.rpc("apply_booking_payment", {
      p_session_id: session,
      p_payment_intent_id: "pi_c",
      p_amount_cents: 5000,
    });
    const fresh = generateAccessToken();
    const { data: moved, error } = await client.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: id,
      p_unit_id: null,
      p_starts_at: slotAt(15),
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    const newId = (moved as Row[])[0].new_booking_id as string;
    const b = await booking(newId);
    expect(b.status).toBe("confirmed");
    expect(b.paid_cents).toBe(5000);
    const { data: rows } = await admin
      .from("booking_payments")
      .select("booking_id")
      .eq("checkout_session_id", session);
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
    const { data: rows } = await admin
      .from("booking_payments")
      .select("provider, status, amount_cents")
      .eq("booking_id", id!);
    expect(rows).toEqual([{ provider: "manual", status: "paid", amount_cents: 5000 }]);
  });

  it("the admin cancel policy lets a member cancel a hold", async () => {
    const { client, orgId, handle } = await newOrg("adm");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    const { data, error } = await client
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", id!)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

// Ledger minor 38: the two payments tables are service_role-only — a signed-in
// member reads them through server code, never from the browser.
describe("grants", () => {
  it("an org member's own client reads neither payments table; service_role does", async () => {
    const { client, orgId, handle } = await newOrg("grants");
    await activeAccount(orgId);
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, 12);
    await ledgerRow(id!, `cs_g_${id}`);

    // 42501 exactly: a typo'd column would also come back as an error, and
    // that would fake this test green.
    const accounts = await client.from("payment_accounts").select("org_id").eq("org_id", orgId);
    expect(accounts.error?.code).toBe("42501");
    expect(accounts.data ?? []).toHaveLength(0);
    const payments = await client.from("booking_payments").select("id").eq("org_id", orgId);
    expect(payments.error?.code).toBe("42501");
    expect(payments.data ?? []).toHaveLength(0);

    const mineAccounts = await admin.from("payment_accounts").select("org_id").eq("org_id", orgId);
    expect(mineAccounts.error).toBeNull();
    expect(mineAccounts.data).toHaveLength(1);
    const minePayments = await admin.from("booking_payments").select("id").eq("org_id", orgId);
    expect(minePayments.error).toBeNull();
    expect(minePayments.data).toHaveLength(1);
  });
});

describe("update_org_payments", () => {
  it("rejects a hold outside the set and a foreign org", async () => {
    const { client, orgId } = await newOrg("org");
    const bad = await client.rpc("update_org_payments", {
      p_org_id: orgId,
      p_hold_min: 45,
      p_legal: {},
    });
    expect(bad.error).not.toBeNull();
    const other = await newOrg("other");
    const foreign = await other.client.rpc("update_org_payments", {
      p_org_id: orgId,
      p_hold_min: 60,
      p_legal: {},
    });
    expect(foreign.error?.message).toMatch(/not found/);
    const ok = await client.rpc("update_org_payments", {
      p_org_id: orgId,
      p_hold_min: 1440,
      p_legal: { legalName: "Studio X", taxId: "1234567890" },
    });
    expect(ok.error).toBeNull();
    const { data } = await admin
      .from("orgs")
      .select("payment_hold_min, legal")
      .eq("id", orgId)
      .single();
    expect(data).toEqual({
      payment_hold_min: 1440,
      legal: { legalName: "Studio X", taxId: "1234567890" },
    });
  });
});
