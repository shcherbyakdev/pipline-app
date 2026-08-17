/**
 * Verifies the PostgREST count embed shape (`rental_units(count)`) that
 * queries.ts's OFFERING_COLUMNS relies on for OfferingRow.unitCount.
 * queries.ts itself uses the cookie-bound server client, which doesn't work
 * outside a request — so this runs the same SELECT string through a
 * signed-in test client instead. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic, not static: queries.ts pulls in @/lib/supabase/server → @/env,
// which parses process.env eagerly at module load. A static import would
// resolve (and fail) before the loadEnvFile() call above ever runs.
const { OFFERING_COLUMNS } = await import("./queries");

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
