/**
 * Tenant-isolation proof, promoted from scripts/verify-foundation.ts into a
 * real test. Requires the local Supabase stack (npm run setup). Creates two
 * throwaway users+orgs per run; a fresh stack (CI) or db:reset clears them.
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

describe("RLS tenant isolation", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceTemplateId: string;

  beforeAll(async () => {
    alice = await signedInUser("alice");
    bob = await signedInUser("bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "Alpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "Beta" });
    if (e2) throw e2;
  });

  it("members see only their own orgs", async () => {
    const { data } = await bob.from("orgs").select("id");
    expect(data).toHaveLength(1);
    expect(data![0].id).not.toBe(aliceOrgId);
  });

  it("a member can create a template with stages in their org", async () => {
    const { data, error } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Store Refresh" })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceTemplateId = data!.id;

    const stages = ["Survey", "Install"].map((name, position) => ({
      template_id: aliceTemplateId,
      org_id: aliceOrgId,
      name,
      position,
    }));
    const { error: stageError } = await alice.from("template_stages").insert(stages);
    expect(stageError).toBeNull();
  });

  it("another org's member cannot see the template", async () => {
    const { data } = await bob.from("templates").select("id").eq("id", aliceTemplateId);
    expect(data).toHaveLength(0);
  });

  it("another org's member cannot insert into a foreign org", async () => {
    const { error } = await bob
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Intrusion" });
    expect(error).not.toBeNull();
  });

  it("reorder RPC rejects a foreign template", async () => {
    const { data: stageRows } = await alice
      .from("template_stages")
      .select("id")
      .eq("template_id", aliceTemplateId);
    const ids = stageRows!.map((s) => s.id);
    const { error } = await bob.rpc("reorder_stages", {
      p_template_id: aliceTemplateId,
      p_stage_ids: ids,
    });
    expect(error).not.toBeNull();
  });

  it("reorder RPC reorders for the owner", async () => {
    const { data: before } = await alice
      .from("template_stages")
      .select("id, name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    const reversed = [...before!].reverse().map((s) => s.id);
    const { error } = await alice.rpc("reorder_stages", {
      p_template_id: aliceTemplateId,
      p_stage_ids: reversed,
    });
    expect(error).toBeNull();
    const { data: after } = await alice
      .from("template_stages")
      .select("name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    expect(after!.map((s) => s.name)).toEqual(before!.map((s) => s.name).reverse());
  });
});
