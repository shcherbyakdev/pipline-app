/**
 * Verifies the PostgREST count embed shape (`rental_units(count)`) that
 * queries.ts's OFFERING_COLUMNS relies on for OfferingRow.unitCount.
 * queries.ts itself uses the cookie-bound server client, which doesn't work
 * outside a request — so that first suite runs the same SELECT string
 * through a signed-in test client instead.
 *
 * The second suite below (`listTimelineData` turnover padding) exercises
 * the real function: `@/lib/supabase/server`'s createClient is swapped for
 * a directly authenticated supabase-js client (the hourly-rpc.integration
 * idiom — auth/actions.test.ts's mock-the-client-boundary applied against
 * the real local stack), since there is no Next request context under
 * vitest to carry a session cookie.
 *
 * Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, wallTimeToUtc } from "@/features/scheduling/slots";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const actingClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => actingClient.current,
}));

// Dynamic, not static: queries.ts pulls in @/lib/supabase/server → @/env,
// which parses process.env eagerly at module load. A static import would
// resolve (and fail) before the loadEnvFile() call above ever runs.
const { OFFERING_COLUMNS, listTimelineData } = await import("./queries");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("queries OFFERING_COLUMNS count embed", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let offeringId: string;

  beforeAll(async () => {
    alice = await signedInUser("rentq_alice");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RentQAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: off, error: e2 } = await alice
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
      })
      .select("id")
      .single();
    if (e2) throw e2;
    offeringId = off!.id;

    const { error: e3 } = await alice
      .from("rental_units")
      .insert([
        { org_id: orgId, offering_id: offeringId, name: "Unit A" },
        { org_id: orgId, offering_id: offeringId, name: "Unit B" },
      ]);
    if (e3) throw e3;
  });

  it("rental_units(count) embed resolves to [{count: n}]", async () => {
    const { data, error } = await alice
      .from("rental_offerings")
      .select(OFFERING_COLUMNS)
      .eq("id", offeringId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as { rental_units: Array<{ count: number }> };
    expect(row.rental_units).toBeInstanceOf(Array);
    expect(row.rental_units[0].count).toBe(2);
  });
});

// R2 deferral (Task 12): a stay whose checkout falls before the timeline's
// window can still leave its turnover tail (the post-checkout cleaning/prep
// days) hanging into the window — `listTimelineData` has to pad the
// bookings fetch's lower bound by the widest turnover_days among the org's
// offerings, or that tail's owning booking never comes back at all.
describe("listTimelineData turnover padding", () => {
  const TZ = "Europe/Berlin";
  const FROM_DATE = "2027-03-10";

  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let unitId: string;

  beforeAll(async () => {
    owner = await signedInUser("rentq_timeline_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentQTimeline" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: off, error: e2 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Cabin",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        turnover_days: 2,
      })
      .select("id")
      .single();
    if (e2) throw e2;
    offeringId = off!.id;

    const { data: unit, error: e3 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Unit A" })
      .select("id")
      .single();
    if (e3) throw e3;
    unitId = unit!.id;

    // This org's owner acts as "the session" for every listTimelineData
    // call below (the createClient() swap at the top of the file).
    actingClient.current = owner;
  });

  async function insertBooking(startDate: string, endDate: string): Promise<string> {
    const { data, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: offeringId,
        rental_unit_id: unitId,
        client_name: "Jamie Doe",
        client_email: "jamie@example.com",
        starts_at: wallTimeToUtc(startDate, "15:00", TZ).toISOString(),
        ends_at: wallTimeToUtc(endDate, "11:00", TZ).toISOString(),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  it("includes a booking that checked out the day before the window when its turnover tail crosses in", async () => {
    // Checks out the day before FROM_DATE; turnover_days=2 means the
    // cleaning tail covers [checkout, checkout+1] = [FROM_DATE-1, FROM_DATE]
    // — the second tail day lands inside the window.
    const tailBookingId = await insertBooking(addDaysISO(FROM_DATE, -3), addDaysISO(FROM_DATE, -1));

    const { bookings } = await listTimelineData(FROM_DATE, TZ);
    expect(bookings.some((b) => b.id === tailBookingId)).toBe(true);
  });

  it("does not reach back further than the widest turnover_days (no tail, no fetch)", async () => {
    // Checks out three days before FROM_DATE; turnover_days=2 means the
    // tail covers [checkout, checkout+1], both still before the window —
    // padding by exactly maxTurnover must not overshoot and pull this in.
    const tooEarlyId = await insertBooking(addDaysISO(FROM_DATE, -5), addDaysISO(FROM_DATE, -3));

    const { bookings } = await listTimelineData(FROM_DATE, TZ);
    expect(bookings.some((b) => b.id === tooEarlyId)).toBe(false);
  });
});
