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
  // Statement-replay coverage below needs the signed-in (RLS-bound) clients
  // themselves, not just the org ids they created.
  let alice: SupabaseClient;
  let bob: SupabaseClient;

  beforeAll(async () => {
    alice = await signedInUser("hourly_guard");
    const { data: org, error } = await alice.rpc("create_org", { p_name: "HourlyGuard", p_offers_appointments: false, p_offers_rentals: true });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    const { data: st, error: stErr } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (stErr) throw stErr;
    staffId = st!.id;

    bob = await signedInUser("hourly_guard_other");
    const { data: otherOrg, error: otherErr } = await bob.rpc("create_org", {
      p_name: "HourlyGuardOther",
      p_offers_appointments: false,
      p_offers_rentals: true,
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

  // Fix round (task-6 review): every test above uses the `admin` service-role
  // client, which bypasses RLS and the authenticated role's column/table
  // grants entirely. Task 6's server actions (scheduling/actions.ts) run on
  // the *authenticated* client, and the supabase-js client is untyped — a
  // typo'd column string, or a grant/RLS gap specific to the offering owner
  // (as opposed to the staff owner these paths were built for), would be a
  // silent zero-match that `tsc` cannot catch and the service-role tests
  // above cannot see. This block replays the exact statement shapes the
  // generalized actions send, through `alice` (a real signed-in member of
  // `orgId`, same as the actions' `createClient()` at request time) and
  // `bob` (a member of a different org), against the same `offeringId`
  // fixture the tests above already share. Weekday 4+ and a fresh date are
  // used throughout so this block never collides with the rows the
  // service-role tests above left behind (weekday 1 has a persisted rule;
  // weekdays 2/3 were rejected inserts, nothing persisted).
  describe("offering-owned availability — authenticated-client statement replay", () => {
    let ruleId: string;

    it("1. INSERTs an offering-owned rule (staff_id explicit null, ownerCols' shape) and SELECTs it back by rental_offering_id", async () => {
      const { data: inserted, error: insertError } = await alice
        .from("availability_rules")
        .insert({
          org_id: orgId,
          staff_id: null,
          rental_offering_id: offeringId,
          weekday: 4,
          start_time: "08:00",
          end_time: "09:00",
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      expect(inserted?.id).toBeTruthy();
      ruleId = inserted!.id as string;

      const { data: rows, error: selectError } = await alice
        .from("availability_rules")
        .select("id, start_time, end_time")
        .eq("rental_offering_id", offeringId)
        .eq("weekday", 4);
      expect(selectError).toBeNull();
      expect(rows).toEqual([{ id: ruleId, start_time: "08:00", end_time: "09:00" }]);
    });

    it("2. UPDATEs that rule's start_time/end_time via the 0035 column-scoped member grant", async () => {
      const { data, error } = await alice
        .from("availability_rules")
        .update({ start_time: "08:30", end_time: "09:30" })
        .eq("id", ruleId)
        .eq("org_id", orgId)
        .select("id, start_time, end_time")
        .maybeSingle();
      expect(error).toBeNull();
      expect(data).toEqual({ id: ruleId, start_time: "08:30", end_time: "09:30" });
    });

    it("3. replays replaceDayExceptions' bridge dance for an offering-owned date, landing on exactly the new open rows", async () => {
      const date = "2027-03-01";

      // Prior state: one open exception row (what a real date already having
      // an override looks like before the rewrite).
      const { data: prior, error: priorError } = await alice
        .from("availability_exceptions")
        .insert({
          org_id: orgId,
          rental_offering_id: offeringId,
          date,
          closed: false,
          start_time: "10:00",
          end_time: "12:00",
        })
        .select("id")
        .single();
      expect(priorError).toBeNull();

      // Bridge: park the day closed (closed rows sit outside the EXCLUDE
      // guard, so this never collides with the prior open row above).
      const { data: bridge, error: bridgeError } = await alice
        .from("availability_exceptions")
        .insert({
          org_id: orgId,
          rental_offering_id: offeringId,
          date,
          closed: true,
          start_time: null,
          end_time: null,
        })
        .select("id")
        .single();
      expect(bridgeError).toBeNull();

      // Delete the old open row(s) — replaceDayExceptions' deleteByIds shape.
      const { error: deleteOldError } = await alice
        .from("availability_exceptions")
        .delete()
        .eq("org_id", orgId)
        .eq("rental_offering_id", offeringId)
        .eq("date", date)
        .in("id", [prior!.id]);
      expect(deleteOldError).toBeNull();

      // Insert the new open rows underneath the still-closed bridge.
      const { error: insertNextError } = await alice.from("availability_exceptions").insert([
        {
          org_id: orgId,
          rental_offering_id: offeringId,
          date,
          closed: false,
          start_time: "09:00",
          end_time: "10:00",
        },
        {
          org_id: orgId,
          rental_offering_id: offeringId,
          date,
          closed: false,
          start_time: "13:00",
          end_time: "15:00",
        },
      ]);
      expect(insertNextError).toBeNull();

      // Lift the bridge.
      const { error: deleteBridgeError } = await alice
        .from("availability_exceptions")
        .delete()
        .eq("org_id", orgId)
        .eq("rental_offering_id", offeringId)
        .eq("date", date)
        .in("id", [bridge!.id]);
      expect(deleteBridgeError).toBeNull();

      const { data: final, error: finalError } = await alice
        .from("availability_exceptions")
        .select("closed, start_time, end_time")
        .eq("rental_offering_id", offeringId)
        .eq("date", date)
        .order("start_time");
      expect(finalError).toBeNull();
      expect(final).toEqual([
        { closed: false, start_time: "09:00", end_time: "10:00" },
        { closed: false, start_time: "13:00", end_time: "15:00" },
      ]);
    });

    it("4. rejects an offering-owned insert from a different org's authenticated user", async () => {
      const { error } = await bob.from("availability_rules").insert({
        org_id: otherOrgId,
        rental_offering_id: offeringId,
        weekday: 6,
        start_time: "09:00",
        end_time: "10:00",
      });
      expect(error).not.toBeNull();
    });

    it("5. DELETEs the offering-owned rule via the org_id + rental_offering_id filter shape copyDayHours' delete step uses", async () => {
      const { error: deleteError } = await alice
        .from("availability_rules")
        .delete()
        .eq("org_id", orgId)
        .eq("rental_offering_id", offeringId)
        .eq("weekday", 4);
      expect(deleteError).toBeNull();

      const { data: rows, error: selectError } = await alice
        .from("availability_rules")
        .select("id")
        .eq("rental_offering_id", offeringId)
        .eq("weekday", 4);
      expect(selectError).toBeNull();
      expect(rows).toEqual([]);
    });
  });
});
