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

describe("requirement RLS + reorder", () => {
  // ORDER-DEPENDENT like the sibling file: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let stageId: string;
  let reqIds: string[] = [];

  beforeAll(async () => {
    alice = await signedInUser("req_alice");
    bob = await signedInUser("req_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ReqAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "ReqBeta" });
    if (e2) throw e2;
    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Req Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: aliceOrgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    stageId = s!.id;
  });

  it("a member creates requirements in their org", async () => {
    const rows = [
      { type: "text", label: "Notes", required: true, config: {}, position: 0 },
      { type: "date", label: "Valid until", required: false, config: {}, position: 1 },
    ].map((r) => ({ ...r, template_stage_id: stageId, org_id: aliceOrgId }));
    const { data, error } = await alice
      .from("template_stage_requirements")
      .insert(rows)
      .select("id");
    expect(error).toBeNull();
    reqIds = data!.map((r) => r.id);
  });

  it("the type CHECK rejects unknown types", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: aliceOrgId,
      type: "video", label: "Nope", required: true, config: {}, position: 9,
    });
    expect(error).not.toBeNull();
  });

  it("a foreign member cannot read or write them", async () => {
    const { data: read } = await bob
      .from("template_stage_requirements")
      .select("id")
      .eq("template_stage_id", stageId);
    expect(read).toHaveLength(0);
    const { error: insertError } = await bob.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: aliceOrgId,
      type: "text", label: "Intrusion", required: true, config: {}, position: 5,
    });
    expect(insertError).not.toBeNull();
    const { data: upd } = await bob
      .from("template_stage_requirements")
      .update({ label: "Hijack" })
      .eq("id", reqIds[0])
      .select();
    expect(upd).toHaveLength(0);
  });

  it("org-mismatch insert is rejected by the guard trigger", async () => {
    // Bob supplies his own org_id but Alice's stage. The guard trigger is
    // SECURITY INVOKER, so it runs as Bob and the stage lookup is subject to
    // RLS: Alice's stage is invisible to him, the lookup returns no row, and
    // the trigger raises 'stage not found' — not 'org mismatch' (that branch
    // is unreachable for a foreign caller; it only fires for an org member
    // supplying a mismatched org_id on their own org's stage).
    const { data: bobOrg } = await bob.from("orgs").select("id").single();
    const { error } = await bob.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: bobOrg!.id,
      type: "text", label: "Sneaky", required: true, config: {}, position: 5,
    });
    expect(error).not.toBeNull();
  });

  it("reorder works for the owner and rejects a foreign caller", async () => {
    const reversed = [...reqIds].reverse();
    const { error } = await alice.rpc("reorder_stage_requirements", {
      p_template_stage_id: stageId, p_requirement_ids: reversed,
    });
    expect(error).toBeNull();
    const { data: after } = await alice
      .from("template_stage_requirements")
      .select("id")
      .eq("template_stage_id", stageId)
      .order("position");
    expect(after!.map((r) => r.id)).toEqual(reversed);

    const { error: bobError } = await bob.rpc("reorder_stage_requirements", {
      p_template_stage_id: stageId, p_requirement_ids: reversed,
    });
    expect(bobError).not.toBeNull();
  });
});
