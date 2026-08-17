/**
 * Tenant isolation + anon-surface posture for the scheduling tables.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

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

describe("RLS scheduling", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let bobOrgId: string;
  let aliceServiceId: string;
  // 0041: availability + appointment bookings hang off a staff row, which
  // create_org seeds for every new org.
  let aliceStaffId: string;

  beforeAll(async () => {
    alice = await signedInUser("sched_alice");
    bob = await signedInUser("sched_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "SchedAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { data: orgB, error: e2 } = await bob.rpc("create_org", { p_name: "SchedBeta" });
    if (e2) throw e2;
    bobOrgId = (orgB as { id: string }).id;
    const { data: st, error: e3 } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", aliceOrgId)
      .single();
    if (e3) throw e3;
    aliceStaffId = st!.id;
  });

  it("member can create a service in their org", async () => {
    const { data, error } = await alice
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Intro Call", duration_min: 30 })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceServiceId = data!.id;
  });

  it("member cannot create a service in a foreign org", async () => {
    const { error } = await bob
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Sneaky", duration_min: 30 });
    expect(error).not.toBeNull();
  });

  it("foreign services are invisible", async () => {
    const { data } = await bob.from("services").select("id").eq("org_id", aliceOrgId);
    expect(data).toEqual([]);
  });

  it("CHECK rejects an out-of-range duration", async () => {
    const { error } = await alice
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Marathon", duration_min: 9999 });
    expect(error).not.toBeNull();
  });

  it("member manages availability rules; foreign org blocked", async () => {
    const { error } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, weekday: 1, start_time: "09:00", end_time: "17:00" });
    expect(error).toBeNull();
    const { error: crossErr } = await bob
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, weekday: 1, start_time: "09:00", end_time: "17:00" });
    expect(crossErr).not.toBeNull();
  });

  it("CHECK rejects a malformed time and an inverted window", async () => {
    const { error: badFormat } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, weekday: 2, start_time: "9am", end_time: "17:00" });
    expect(badFormat).not.toBeNull();
    const { error: inverted } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, weekday: 2, start_time: "17:00", end_time: "09:00" });
    expect(inverted).not.toBeNull();
  });

  it("exception shape CHECK: open exception needs a valid window", async () => {
    const { error } = await alice
      .from("availability_exceptions")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, date: "2027-01-04", closed: false });
    expect(error).not.toBeNull();
    const { error: ok } = await alice
      .from("availability_exceptions")
      .insert({ org_id: aliceOrgId, staff_id: aliceStaffId, date: "2027-01-04", closed: true });
    expect(ok).toBeNull();
  });

  it("anon reads nothing from any scheduling table", async () => {
    for (const table of ["services", "availability_rules", "availability_exceptions", "bookings"]) {
      const { data, error } = await anon.from(table).select("id").limit(1);
      // Grant-less access surfaces as an error or an empty set depending on
      // PostgREST version — both prove the deny posture.
      expect(error !== null || data?.length === 0).toBe(true);
    }
  });

  it("authenticated cannot insert bookings directly (RPC-only path)", async () => {
    const { error } = await alice.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: aliceServiceId,
      staff_id: aliceStaffId,
      client_name: "X",
      client_email: "x@example.com",
      starts_at: "2027-01-05T10:00:00Z",
      ends_at: "2027-01-05T10:30:00Z",
      cancel_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).not.toBeNull();
  });

  it("member sees own-org bookings; foreign org sees none", async () => {
    const { error } = await admin.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: aliceServiceId,
      staff_id: aliceStaffId,
      client_name: "Seeded",
      client_email: "seeded@example.com",
      starts_at: "2027-01-06T10:00:00Z",
      ends_at: "2027-01-06T10:30:00Z",
      cancel_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    const { data: mine } = await alice.from("bookings").select("id").eq("org_id", aliceOrgId);
    expect(mine!.length).toBeGreaterThan(0);
    const { data: theirs } = await bob.from("bookings").select("id").eq("org_id", aliceOrgId);
    expect(theirs).toEqual([]);
  });

  it("org guard trigger rejects a cross-org service on a booking", async () => {
    const { data: bobService, error: e } = await bob
      .from("services")
      .insert({ org_id: bobOrgId, name: "Bob Svc", duration_min: 30 })
      .select("id")
      .single();
    expect(e).toBeNull();
    const { error } = await admin.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: bobService!.id,
      staff_id: aliceStaffId,
      client_name: "X",
      client_email: "x2@example.com",
      starts_at: "2027-01-07T10:00:00Z",
      ends_at: "2027-01-07T10:30:00Z",
      cancel_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).not.toBeNull();
  });
});
