/**
 * Tenant isolation + anon-surface posture for the rentals tables (0037).
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

describe("RLS rentals", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let bobOrgId: string;
  let offeringId: string;
  let unitId: string;

  beforeAll(async () => {
    alice = await signedInUser("rent_alice");
    bob = await signedInUser("rent_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "RentAlpha", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { data: orgB, error: e2 } = await bob.rpc("create_org", { p_name: "RentBeta", p_offers_appointments: false, p_offers_rentals: true });
    if (e2) throw e2;
    bobOrgId = (orgB as { id: string }).id;
  });

  it("member can create an offering, a unit and a blackout in their org", async () => {
    const { data: off, error } = await alice
      .from("rental_offerings")
      .insert({
        org_id: aliceOrgId,
        name: "Studio",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    offeringId = off!.id;
    const { data: unit, error: e2 } = await alice
      .from("rental_units")
      .insert({ org_id: aliceOrgId, offering_id: offeringId, name: "2B" })
      .select("id")
      .single();
    expect(e2).toBeNull();
    unitId = unit!.id;
    const { error: e3 } = await alice.from("rental_unit_blackouts").insert({
      org_id: aliceOrgId,
      rental_unit_id: unitId,
      start_date: "2027-05-01",
      end_date: "2027-05-03",
    });
    expect(e3).toBeNull();
  });

  it("member cannot create rows in a foreign org", async () => {
    const { error } = await bob.from("rental_offerings").insert({
      org_id: aliceOrgId,
      name: "X",
      range_mode: "days",
      start_time: "09:00",
      end_time: "18:00",
    });
    expect(error).not.toBeNull();
    const { error: e2 } = await bob
      .from("rental_units")
      .insert({ org_id: bobOrgId, offering_id: offeringId, name: "Sneaky" });
    expect(e2).not.toBeNull(); // org guard trigger: unit org must match offering org
  });

  it("foreign rows are invisible", async () => {
    const { data } = await bob.from("rental_offerings").select("id");
    expect((data ?? []).some((r) => r.id === offeringId)).toBe(false);
    const { data: units } = await bob.from("rental_units").select("id");
    expect((units ?? []).some((r) => r.id === unitId)).toBe(false);
  });

  it("CHECKs reject bad values", async () => {
    const bad = await alice.from("rental_offerings").insert({
      org_id: aliceOrgId,
      name: "Bad",
      range_mode: "weeks",
      start_time: "15:00",
      end_time: "11:00",
    });
    expect(bad.error).not.toBeNull();
    const badStay = await alice.from("rental_offerings").insert({
      org_id: aliceOrgId,
      name: "Bad",
      range_mode: "nights",
      start_time: "15:00",
      end_time: "11:00",
      min_stay: 0,
    });
    expect(badStay.error).not.toBeNull();
    const badRange = await alice.from("rental_unit_blackouts").insert({
      org_id: aliceOrgId,
      rental_unit_id: unitId,
      start_date: "2027-05-03",
      end_date: "2027-05-01",
    });
    expect(badRange.error).not.toBeNull();
  });

  it("anon reads nothing from any rentals table", async () => {
    for (const table of ["rental_offerings", "rental_units", "rental_unit_blackouts"] as const) {
      const { data, error } = await anon.from(table).select("id");
      // Grant-less access surfaces as an error or an empty set depending on
      // PostgREST version — both prove the deny posture.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });
});
