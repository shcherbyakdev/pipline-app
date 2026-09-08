/**
 * S4 loader against the local stack: the three sections, their windows and
 * the org gate, once through the admin client and once as a member.
 * Requires `supabase start`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { loadDailyList } = await import("./daily-list");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
const DAY = "2027-08-02"; // far future: the create RPC only takes future starts
const H = 60 * 60 * 1000;
const D = 24 * H;
let counter = 0;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `dl_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
    p_name: `S4 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s4dl-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: off, error: e3 } = await client
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
  if (e3) throw e3;
  const { error: e4 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e4) throw e4;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e5 } = await client.from("availability_rules").insert(rules);
  if (e5) throw e5;
  return { client, orgId, handle, offeringId: off!.id as string };
}

/** A confirmed booking at DAY hh:00 (no payment account → confirmed, pay at
    the venue). `hour` keeps rows apart under the unit's EXCLUDE. */
async function createHours(handle: string, offeringId: string, hour: number, name: string) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, TZ).toISOString(),
    p_duration_min: 60,
    p_name: name,
    p_email: `c${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return data as string;
}

/** Service-role edits that put a row into the state under test. The
    EXCLUDE constraint is per unit and the moved rows land on distinct days. */
async function patch(id: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("bookings").update(fields).eq("id", id);
  if (error) throw error;
}

function at(offsetMs: number, now: Date) {
  return new Date(now.getTime() + offsetMs).toISOString();
}

describe("loadDailyList", () => {
  const now = new Date();
  let org: Awaited<ReturnType<typeof newOrg>>;
  let ids: Record<string, string>;

  beforeAll(async () => {
    org = await newOrg("main");
    const o = org;
    ids = {
      requestIn: await createHours(o.handle, o.offeringId, 8, "Request In"),
      requestPast: await createHours(o.handle, o.offeringId, 9, "Request Past"),
      holdSoon: await createHours(o.handle, o.offeringId, 10, "Hold Soon"),
      holdLapsed: await createHours(o.handle, o.offeringId, 11, "Hold Lapsed"),
      holdFar: await createHours(o.handle, o.offeringId, 12, "Hold Far"),
      endedUnpaid: await createHours(o.handle, o.offeringId, 13, "Ended Unpaid"),
      endedPaid: await createHours(o.handle, o.offeringId, 14, "Ended Paid"),
      endedWrittenOff: await createHours(o.handle, o.offeringId, 15, "Ended Written Off"),
      endedOld: await createHours(o.handle, o.offeringId, 16, "Ended Old"),
      futureUnpaid: await createHours(o.handle, o.offeringId, 17, "Future Unpaid"),
    };
    // Requests: pending, one in the future (in), one in the past (out).
    await patch(ids.requestIn, { status: "pending" });
    await patch(ids.requestPast, { status: "pending", starts_at: at(-3 * D, now), ends_at: at(-3 * D + H, now) });
    // Holds: +2 h (in), −5 min not yet swept (in, first), +30 h (out).
    await patch(ids.holdSoon, { status: "pending_payment", hold_expires_at: at(2 * H, now) });
    await patch(ids.holdLapsed, { status: "pending_payment", hold_expires_at: at(-5 * 60_000, now) });
    await patch(ids.holdFar, { status: "pending_payment", hold_expires_at: at(30 * H, now) });
    // Balances: ended yesterday unpaid (in: balance = price 10000); ended and
    // fully paid (out); ended and written off (out); ended 40 days ago (out);
    // still in the future and unpaid (out).
    await patch(ids.endedUnpaid, { starts_at: at(-1 * D, now), ends_at: at(-1 * D + H, now) });
    await patch(ids.endedPaid, { starts_at: at(-2 * D, now), ends_at: at(-2 * D + H, now), paid_cents: 10000 });
    await patch(ids.endedWrittenOff, { starts_at: at(-4 * D, now), ends_at: at(-4 * D + H, now), written_off_cents: 10000 });
    await patch(ids.endedOld, { starts_at: at(-40 * D, now), ends_at: at(-40 * D + H, now) });
    // A stranger org with an ended unpaid booking: never in this org's list.
    const other = await newOrg("other");
    const strangerId = await createHours(other.handle, other.offeringId, 13, "Stranger");
    await patch(strangerId, { starts_at: at(-1 * D, now), ends_at: at(-1 * D + H, now) });
    ids.stranger = strangerId;
  });

  it("admin client: exactly the right rows, in order, with the SQL balance", async () => {
    const list = await loadDailyList(admin, org.orgId, "Booking", new Date());
    expect(list.requests.map((b) => b.id)).toEqual([ids.requestIn]);
    expect(list.holds.map((b) => b.id)).toEqual([ids.holdLapsed, ids.holdSoon]);
    expect(list.balances.map((b) => b.id)).toEqual([ids.endedUnpaid]);
    expect(list.balances[0].balanceCents).toBe(10000);
    expect(list.balances[0].clientName).toBe("Ended Unpaid");
  });

  it("member client (RLS): the same list", async () => {
    const list = await loadDailyList(org.client, org.orgId, "Booking", new Date());
    expect(list.requests.map((b) => b.id)).toEqual([ids.requestIn]);
    expect(list.holds.map((b) => b.id)).toEqual([ids.holdLapsed, ids.holdSoon]);
    expect(list.balances.map((b) => b.id)).toEqual([ids.endedUnpaid]);
  });

  it("list_balances_due: a signed-in non-member gets no rows, not an error", async () => {
    const outsider = await signedInUser("outsider");
    const { data, error } = await outsider.rpc("list_balances_due", {
      p_org_id: org.orgId,
      p_since: new Date(Date.now() - 30 * D).toISOString(),
      p_limit: 50,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("list_balances_due: anon is refused", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc("list_balances_due", {
      p_org_id: org.orgId,
      p_since: new Date(Date.now() - 30 * D).toISOString(),
      p_limit: 50,
    });
    expect(error).not.toBeNull();
  });
});
