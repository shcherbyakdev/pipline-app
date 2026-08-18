/**
 * 0035: overlap EXCLUDE guards on availability tables + the member UPDATE
 * path on availability_rules. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("availability overlap guards (0035)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  // 0041: availability is keyed to a staff member, not the org. create_org
  // seeds exactly one staff row — the guards below are per-staff now.
  let staffId: string;

  beforeAll(async () => {
    owner = await signedInUser("avail_guard");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "AvailGuardCo" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    const { data: st, error: stErr } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (stErr) throw stErr;
    staffId = st!.id;
  });

  it("rejects an overlapping rule with 23P01, allows touching", async () => {
    const { error: first } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 1, start_time: "09:00", end_time: "13:00" });
    expect(first).toBeNull();
    const { error: overlap } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 1, start_time: "12:00", end_time: "14:00" });
    expect(overlap?.code).toBe("23P01");
    const { error: touching } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 1, start_time: "13:00", end_time: "17:00" });
    expect(touching).toBeNull();
    // Same window on another weekday is fine.
    const { error: otherDay } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 2, start_time: "09:00", end_time: "13:00" });
    expect(otherDay).toBeNull();
  });

  it("member can update a rule's times; updating into overlap is 23P01", async () => {
    const { data: row, error } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 3, start_time: "09:00", end_time: "11:00" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: e2 } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, staff_id: staffId, weekday: 3, start_time: "12:00", end_time: "14:00" });
    expect(e2).toBeNull();

    const { data: updated, error: updateError } = await owner
      .from("availability_rules")
      .update({ start_time: "08:00", end_time: "10:00" })
      .eq("id", row!.id)
      .select("id")
      .maybeSingle();
    expect(updateError).toBeNull();
    expect(updated?.id).toBe(row!.id);

    const { error: overlapUpdate } = await owner
      .from("availability_rules")
      .update({ end_time: "12:30" })
      .eq("id", row!.id);
    expect(overlapUpdate?.code).toBe("23P01");
  });

  it("open override windows can't overlap on one date; closed rows are exempt", async () => {
    const DATE = "2027-06-01";
    const { error: w1 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: DATE, closed: false, start_time: "09:00", end_time: "12:00" });
    expect(w1).toBeNull();
    const { error: w2 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: DATE, closed: false, start_time: "11:00", end_time: "13:00" });
    expect(w2?.code).toBe("23P01");
    const { error: touching } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: DATE, closed: false, start_time: "12:00", end_time: "14:00" });
    expect(touching).toBeNull();
    // A closed row on another date never trips the (partial) constraint,
    // and two closed rows may coexist.
    const CLOSED = "2027-06-02";
    const { error: c1 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: CLOSED, closed: true, start_time: null, end_time: null });
    expect(c1).toBeNull();
    const { error: c2 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: CLOSED, closed: true, start_time: null, end_time: null });
    expect(c2).toBeNull();
  });
});
