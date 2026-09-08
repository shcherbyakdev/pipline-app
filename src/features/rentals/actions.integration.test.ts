/**
 * createOffering against the real local stack. The unit suite
 * (actions.test.ts) mocks the Supabase client, so it cannot see PostgREST's
 * rule about bulk inserts — and that rule is exactly what broke an equipment
 * space with several items: PostgREST unions a bulk insert's keys and sends
 * NULL for any key a row omits, so a first unit without `sort_order` made
 * every row fail rental_units' NOT NULL. Only a live insert catches that.
 *
 * The action runs for real past the client boundary: `@/lib/supabase/server`'s
 * cookie client is swapped for a directly authenticated supabase-js client
 * (the hourly-rpc.integration idiom — there is no Next request context under
 * vitest to carry a session cookie), and next/cache's revalidatePath is a
 * no-op (it throws outside a request scope).
 *
 * Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const actingClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => actingClient.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Dynamic: actions.ts pulls in @/env, which parses process.env eagerly at
// module load — a static import would run before loadEnvFile above.
const { createOffering } = await import("./actions");

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

describe("createOffering — an equipment space's items", () => {
  let alice: SupabaseClient;
  let orgId: string;

  beforeAll(async () => {
    alice = await signedInUser("s6_items");
    const { data: org, error } = await alice.rpc("create_org", {
      p_name: "S6Items",
      p_offers_appointments: false,
      p_offers_rentals: true,
    });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    // Plan caps are not this suite's subject (hourly-flow precedent): the
    // premium waitlist flag (default on) caps a new org at Free's two
    // resources, and an equipment space now spends one slot per item.
    const { error: flagError } = await admin
      .from("org_feature_flags")
      .insert({ org_id: orgId, flag: "premium_waitlist", enabled: false, updated_by: "s6-items-test" });
    if (flagError) throw flagError;
    actingClient.current = alice;
  });

  const equipment = (name: string, itemCount: number) => ({
    name,
    rangeMode: "hours",
    kind: "equipment",
    itemCount,
    slotIncrementMin: 30,
    minDurationMin: 60,
    maxDurationMin: 240,
    priceCents: 5000,
  });

  async function unitsOf(name: string) {
    const { data: off, error } = await alice
      .from("rental_offerings")
      .select("id, kind")
      .eq("org_id", orgId)
      .eq("name", name)
      .single();
    if (error) throw error;
    const { data: units, error: unitsError } = await alice
      .from("rental_units")
      .select("name, sort_order, active")
      .eq("offering_id", off!.id)
      .order("sort_order");
    if (unitsError) throw unitsError;
    return { kind: off!.kind as string, units: units ?? [] };
  }

  it("three items become three units, numbered 0,1,2 — the bulk insert's rows share their keys", async () => {
    const name = `Lamp ${Date.now()}`;
    expect(await createOffering(equipment(name, 3))).toEqual({ ok: true });
    const { kind, units } = await unitsOf(name);
    expect(kind).toBe("equipment");
    expect(units).toEqual([
      { name, sort_order: 0, active: true },
      { name: `${name} 2`, sort_order: 1, active: true },
      { name: `${name} 3`, sort_order: 2, active: true },
    ]);
  });

  it("the plan gate counts every item, so an over-budget set is refused before anything is written", async () => {
    const { error: onError } = await admin
      .from("org_feature_flags")
      .update({ enabled: true })
      .eq("org_id", orgId)
      .eq("flag", "premium_waitlist");
    if (onError) throw onError;
    const name = `Capped ${Date.now()}`;
    try {
      // Free is two resources and the org already holds three units, but even
      // an empty org could not take three items at once: gating on one would
      // land the rest over budget and evict a room from the public page.
      const refused = await createOffering(equipment(name, 3));
      expect(refused).toMatchObject({ ok: false });
      const { data: leftover } = await alice
        .from("rental_offerings")
        .select("id")
        .eq("org_id", orgId)
        .eq("name", name);
      expect(leftover).toEqual([]);
    } finally {
      await admin
        .from("org_feature_flags")
        .update({ enabled: false })
        .eq("org_id", orgId)
        .eq("flag", "premium_waitlist");
    }
  });
});
