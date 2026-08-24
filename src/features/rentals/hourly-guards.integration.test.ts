/**
 * Hourly mode (H2) security surface: rental_offerings mode + per-mode field
 * CHECKs, the availability owner XOR (staff | rental_offering), the
 * offering-keyed EXCLUDE twins, and the org-consistency trigger (0056).
 * Requires the local Supabase stack (npm run setup).
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

describe("hourly mode guards (0056)", () => {
  let orgId: string;
  let otherOrgId: string;
  let offeringId: string;
  let staffId: string;

  beforeAll(async () => {
    const alice = await signedInUser("hourly_guard");
    const { data: org, error } = await alice.rpc("create_org", { p_name: "HourlyGuard" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    const { data: st, error: stErr } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (stErr) throw stErr;
    staffId = st!.id;

    const bob = await signedInUser("hourly_guard_other");
    const { data: otherOrg, error: otherErr } = await bob.rpc("create_org", {
      p_name: "HourlyGuardOther",
    });
    if (otherErr) throw otherErr;
    otherOrgId = (otherOrg as { id: string }).id;

    const { data: offering, error: offErr } = await admin
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Base Offering",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
      })
      .select("id")
      .single();
    if (offErr) throw offErr;
    offeringId = offering!.id as string;
  });

  it("accepts an hours offering with the duration trio", async () => {
    const { error } = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Room A",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
    });
    expect(error).toBeNull();
  });

  it("rejects an hours offering missing max_duration_min", async () => {
    const { error } = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
    });
    expect(error?.code).toBe("23514"); // check_violation
  });

  it("rejects an hours offering with start_time set", async () => {
    const { error } = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "hours",
      start_time: "09:00",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
    });
    expect(error?.code).toBe("23514");
  });

  it("rejects a nights offering without start/end times", async () => {
    const { error } = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "nights",
    });
    expect(error?.code).toBe("23514");
  });

  it("rejects a nights offering with exactly one of start_time/end_time set", async () => {
    const startOnly = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "nights",
      start_time: "09:00",
    });
    expect(startOnly.error?.code).toBe("23514");
    const endOnly = await admin.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "nights",
      end_time: "11:00",
    });
    expect(endOnly.error?.code).toBe("23514");
  });

  it("accepts an offering-owned availability rule and rejects a two-owner row", async () => {
    const ok = await admin.from("availability_rules").insert({
      org_id: orgId,
      rental_offering_id: offeringId,
      weekday: 1,
      start_time: "09:00",
      end_time: "21:00",
    });
    expect(ok.error).toBeNull();
    const bad = await admin.from("availability_rules").insert({
      org_id: orgId,
      rental_offering_id: offeringId,
      staff_id: staffId,
      weekday: 2,
      start_time: "09:00",
      end_time: "21:00",
    });
    expect(bad.error?.code).toBe("23514");
  });

  it("rejects overlapping offering rules on the same weekday (EXCLUDE twin)", async () => {
    const { error } = await admin.from("availability_rules").insert({
      org_id: orgId,
      rental_offering_id: offeringId,
      weekday: 1,
      start_time: "10:00",
      end_time: "12:00",
    });
    expect(error?.code).toBe("23P01"); // exclusion_violation
  });

  it("rejects an availability rule whose offering belongs to another org", async () => {
    const { error } = await admin.from("availability_rules").insert({
      org_id: otherOrgId,
      rental_offering_id: offeringId,
      weekday: 3,
      start_time: "09:00",
      end_time: "10:00",
    });
    expect(error?.message).toMatch(/org mismatch/);
  });
});
