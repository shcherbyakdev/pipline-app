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
});
