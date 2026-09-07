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
    // A distinct free-tier hour (not 100): the first test's booking at
    // startIn(100) stays confirmed forever and occupies that slot.
    const free = await createHours(handle, offeringId, startIn(110));
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

  it("rounds the fee like the twin (half up)", async () => {
    const org = await newOrg("round");
    const { offeringId: off } = await hoursFixture(org.client, org.orgId, { price_cents: 101 });
    const { id, token } = await createHours(org.handle, off, startIn(60));
    const { error } = await admin.rpc("cancel_booking", { p_token: token });
    expect(error).toBeNull();
    const row = await bookingRow(id);
    expect(row.fee_cents).toBe(51); // 101 × 50% = 50.5 → 51
    expect(row.price_cents).toBe(101);
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
