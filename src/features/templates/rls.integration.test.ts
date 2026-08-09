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
  // These `it` blocks are ORDER-DEPENDENT, not independent cases: an early
  // test creates aliceTemplateId (and its stages), and every later test
  // consumes that state. Do not mark any of these `.concurrent` and do not
  // let the runner shuffle/reorder them — they must run sequentially, in
  // file order, exactly as vitest does by default.
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

  it("another org's member cannot read a foreign template's stages directly", async () => {
    const { data: byTemplate } = await bob
      .from("template_stages")
      .select("id")
      .eq("template_id", aliceTemplateId);
    expect(byTemplate).toHaveLength(0);

    const { data: aliceStages } = await alice
      .from("template_stages")
      .select("id")
      .eq("template_id", aliceTemplateId);
    const stageId = aliceStages![0].id;

    const { data: byId } = await bob.from("template_stages").select("id").eq("id", stageId);
    expect(byId).toHaveLength(0);
  });

  it("another org's member cannot insert into a foreign org", async () => {
    const { error } = await bob
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Intrusion" });
    expect(error).not.toBeNull();
  });

  it("another org's member cannot insert a stage into a foreign template", async () => {
    // Either RLS's with-check (org_id not in Bob's orgs) or the
    // check_template_stage_org trigger (org mismatch against the real
    // template owner) can be what fails this — both are a pass. The error
    // text is not a stable contract, so we don't assert on it.
    const { error } = await bob.from("template_stages").insert({
      template_id: aliceTemplateId,
      org_id: aliceOrgId,
      name: "Intrusion Stage",
      position: 99,
    });
    expect(error).not.toBeNull();
  });

  it("another org's member cannot update a foreign template", async () => {
    // PostgREST + RLS does not error on a filtered update — the USING
    // clause hides the row from Bob, so the update matches 0 rows and
    // returns no error. The proof is the pair: 0 rows affected here, AND
    // the value unchanged when re-read as the owner below.
    const { data, error } = await bob
      .from("templates")
      .update({ name: "Hijacked" })
      .eq("id", aliceTemplateId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: check } = await alice
      .from("templates")
      .select("name")
      .eq("id", aliceTemplateId)
      .single();
    expect(check!.name).toBe("Store Refresh");
  });

  it("another org's member cannot update a foreign stage", async () => {
    const { data: stages } = await alice
      .from("template_stages")
      .select("id, name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    const target = stages![0];

    const { data, error } = await bob
      .from("template_stages")
      .update({ name: "Hijacked Stage" })
      .eq("id", target.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: check } = await alice
      .from("template_stages")
      .select("name")
      .eq("id", target.id)
      .single();
    expect(check!.name).toBe(target.name);
  });

  it("another org's member cannot delete a foreign template", async () => {
    // Same reasoning as the update case: a filtered delete matches 0 rows
    // and returns no error, so we assert 0 affected AND that the row still
    // exists under the owner's view.
    const { data, error } = await bob.from("templates").delete().eq("id", aliceTemplateId).select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: check } = await alice.from("templates").select("id").eq("id", aliceTemplateId);
    expect(check).toHaveLength(1);
  });

  it("another org's member cannot delete a foreign stage", async () => {
    const { data: stages } = await alice
      .from("template_stages")
      .select("id")
      .eq("template_id", aliceTemplateId)
      .order("position");
    const target = stages![0];

    const { data, error } = await bob
      .from("template_stages")
      .delete()
      .eq("id", target.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: check } = await alice.from("template_stages").select("id").eq("id", target.id);
    expect(check).toHaveLength(1);
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
