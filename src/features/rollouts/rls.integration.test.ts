/**
 * Tenant-isolation + RPC-only-creation proof for rollouts, mirroring
 * src/features/templates/rls.integration.test.ts. Requires the local
 * Supabase stack (npm run setup). Creates two throwaway users+orgs per run;
 * a fresh stack (CI) or db:reset clears them.
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

describe("RLS rollouts", () => {
  // These `it` blocks are ORDER-DEPENDENT, not independent cases: an early
  // test creates aliceTemplateId (with stages S1/S2) and aliceRolloutId (via
  // the create_rollout RPC), and every later test consumes that state. Do
  // not mark any of these `.concurrent` and do not let the runner
  // shuffle/reorder them — they must run sequentially, in file order,
  // exactly as vitest does by default.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceTemplateId: string;
  let aliceRolloutId: string;

  beforeAll(async () => {
    // Tags are prefixed "rollout_" (not "alice"/"bob") because this suite
    // runs in the same `test:integration` process as
    // templates/rls.integration.test.ts, which uses those bare tags — two
    // files calling signedInUser("alice") can land on the exact same
    // Date.now() millisecond when vitest runs files in parallel, producing
    // a genuine auth.users email collision (observed while writing this
    // suite). Distinct tags make the emails disjoint regardless of timing.
    alice = await signedInUser("rollout_alice");
    bob = await signedInUser("rollout_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "Alpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "Beta" });
    if (e2) throw e2;

    // Members may write templates directly (0003); the rollout fixture rides
    // on that, not on the RPC.
    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "RLS Rollout Fixture" })
      .select("id")
      .single();
    if (e3) throw e3;
    aliceTemplateId = (template as { id: string }).id;

    const stages = ["S1", "S2"].map((name, position) => ({
      template_id: aliceTemplateId,
      org_id: aliceOrgId,
      name,
      position,
    }));
    const { error: e4 } = await alice.from("template_stages").insert(stages);
    if (e4) throw e4;
  });

  it("create_rollout rejects a foreign template", async () => {
    const { error } = await bob.rpc("create_rollout", {
      p_template_id: aliceTemplateId,
      p_name: "Intrusion Rollout",
    });
    expect(error).not.toBeNull();
  });

  it("create_rollout rejects a stage-less template", async () => {
    const { data: empty, error: insertError } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Empty" })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { error } = await alice.rpc("create_rollout", {
      p_template_id: (empty as { id: string }).id,
      p_name: "Should Fail",
    });
    expect(error).not.toBeNull();
  });

  it("create_rollout rejects a blank name", async () => {
    const { error } = await alice.rpc("create_rollout", {
      p_template_id: aliceTemplateId,
      p_name: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("create_rollout snapshots stages for the owner", async () => {
    const { data, error } = await alice.rpc("create_rollout", {
      p_template_id: aliceTemplateId,
      p_name: "R1",
    });
    expect(error).toBeNull();
    aliceRolloutId = (data as { id: string }).id;

    const { data: stages } = await alice
      .from("rollout_stages")
      .select("name, position")
      .eq("rollout_id", aliceRolloutId)
      .order("position");
    expect(stages!.map((s) => s.name)).toEqual(["S1", "S2"]);
    expect(stages!.map((s) => s.position)).toEqual([0, 1]);
  });

  it("direct insert into rollouts is denied even for one's own org", async () => {
    // RPC-only creation: locally this is stopped by RLS (no insert policy),
    // in CI by the GRANT (no insert grant at all) — both are errors, so a
    // plain error assertion is portable across environments.
    const { error } = await alice.from("rollouts").insert({ org_id: aliceOrgId, name: "direct" });
    expect(error).not.toBeNull();
  });

  it("rollout_stages is immutable for authenticated", async () => {
    // INSERT errors in both environments (RLS with-check violation locally,
    // permission-denied GRANT failure in CI), so a plain error assertion is
    // portable.
    const { error: insertError } = await alice.from("rollout_stages").insert({
      rollout_id: aliceRolloutId,
      org_id: aliceOrgId,
      name: "Intrusion Stage",
      position: 99,
    });
    expect(insertError).not.toBeNull();

    // UPDATE/DELETE diverge: locally there is no update/delete POLICY on
    // rollout_stages, so the write silently matches 0 rows (error null);
    // in CI there is no update/delete GRANT either, so it fails outright
    // (error non-null). Assert only the effect — no rows changed — and
    // never assert on error for these two, so the same test is true in
    // both environments. Re-reading as the owner (alice, an org member who
    // can select) proves the row itself is untouched.
    const { data: before } = await alice
      .from("rollout_stages")
      .select("id, name")
      .eq("rollout_id", aliceRolloutId)
      .order("position");
    const [updateTarget, deleteTarget] = before!;

    const { data: updateData } = await alice
      .from("rollout_stages")
      .update({ name: "Hijacked Stage" })
      .eq("id", updateTarget.id)
      .select();
    expect(updateData ?? []).toHaveLength(0);

    const { data: updateCheck } = await alice
      .from("rollout_stages")
      .select("name")
      .eq("id", updateTarget.id)
      .single();
    expect(updateCheck!.name).toBe(updateTarget.name);

    const { data: deleteData } = await alice
      .from("rollout_stages")
      .delete()
      .eq("id", deleteTarget.id)
      .select();
    expect(deleteData ?? []).toHaveLength(0);

    const { data: deleteCheck } = await alice
      .from("rollout_stages")
      .select("id")
      .eq("id", deleteTarget.id);
    expect(deleteCheck).toHaveLength(1);
  });

  it("foreign member sees no rollouts or units", async () => {
    const { data: rolloutsSeen } = await bob.from("rollouts").select("id").eq("id", aliceRolloutId);
    expect(rolloutsSeen).toHaveLength(0);

    const { data: unitsSeen } = await bob
      .from("units")
      .select("id")
      .eq("rollout_id", aliceRolloutId);
    expect(unitsSeen).toHaveLength(0);
  });

  it("foreign member cannot insert a unit into the rollout", async () => {
    const { error } = await bob.from("units").insert({
      rollout_id: aliceRolloutId,
      org_id: aliceOrgId,
      name: "Intrusion Unit",
    });
    expect(error).not.toBeNull();
  });

  it("update/delete denial on rollouts and units", async () => {
    // Same reasoning as the templates suite: a filtered update/delete that
    // the USING clause hides matches 0 rows and returns no error, so the
    // proof is the pair — 0 rows affected here, and the value/row unchanged
    // when re-read as the owner below.
    const { data: rolloutUpdateData, error: rolloutUpdateError } = await bob
      .from("rollouts")
      .update({ name: "Hijacked Rollout" })
      .eq("id", aliceRolloutId)
      .select();
    expect(rolloutUpdateError).toBeNull();
    expect(rolloutUpdateData).toHaveLength(0);

    const { data: rolloutDeleteData, error: rolloutDeleteError } = await bob
      .from("rollouts")
      .delete()
      .eq("id", aliceRolloutId)
      .select();
    expect(rolloutDeleteError).toBeNull();
    expect(rolloutDeleteData).toHaveLength(0);

    const { data: rolloutCheck } = await alice
      .from("rollouts")
      .select("name")
      .eq("id", aliceRolloutId)
      .single();
    expect(rolloutCheck!.name).toBe("R1");

    // units — alice creates one first so there is a real foreign row for
    // Bob to (fail to) hijack.
    const { data: unit, error: unitInsertError } = await alice
      .from("units")
      .insert({ rollout_id: aliceRolloutId, org_id: aliceOrgId, name: "Store #1" })
      .select("id, name")
      .single();
    expect(unitInsertError).toBeNull();
    const unitId = (unit as { id: string }).id;

    const { data: unitUpdateData, error: unitUpdateError } = await bob
      .from("units")
      .update({ name: "Hijacked Unit" })
      .eq("id", unitId)
      .select();
    expect(unitUpdateError).toBeNull();
    expect(unitUpdateData).toHaveLength(0);

    const { data: unitDeleteData, error: unitDeleteError } = await bob
      .from("units")
      .delete()
      .eq("id", unitId)
      .select();
    expect(unitDeleteError).toBeNull();
    expect(unitDeleteData).toHaveLength(0);

    const { data: unitCheck } = await alice.from("units").select("name").eq("id", unitId).single();
    expect(unitCheck!.name).toBe("Store #1");
  });

  it("snapshot is independent of the template", async () => {
    // Renaming the template's own stage must not touch the already-created
    // rollout's frozen snapshot.
    const { data: templateStages } = await alice
      .from("template_stages")
      .select("id, name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    const s1 = templateStages!.find((s) => s.name === "S1")!;
    const { error: renameError } = await alice
      .from("template_stages")
      .update({ name: "S1-edited" })
      .eq("id", s1.id);
    expect(renameError).toBeNull();

    const { error: deleteTemplateError } = await alice
      .from("templates")
      .delete()
      .eq("id", aliceTemplateId);
    expect(deleteTemplateError).toBeNull();

    const { data: rollout } = await alice
      .from("rollouts")
      .select("id, template_id")
      .eq("id", aliceRolloutId)
      .single();
    expect(rollout).not.toBeNull();
    expect(rollout!.template_id).toBeNull();

    const { data: stagesAfter } = await alice
      .from("rollout_stages")
      .select("name")
      .eq("rollout_id", aliceRolloutId)
      .order("position");
    expect(stagesAfter!.map((s) => s.name)).toEqual(["S1", "S2"]);
  });
});
