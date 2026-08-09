/**
 * Tenant-isolation + RPC-only-creation proof for programs, mirroring
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

describe("RLS programs", () => {
  // These `it` blocks are ORDER-DEPENDENT, not independent cases: an early
  // test creates aliceTemplateId (with stages S1/S2) and aliceProgramId (via
  // the create_program RPC), and every later test consumes that state. Do
  // not mark any of these `.concurrent` and do not let the runner
  // shuffle/reorder them — they must run sequentially, in file order,
  // exactly as vitest does by default.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceTemplateId: string;
  let aliceProgramId: string;

  beforeAll(async () => {
    // Tags are prefixed "program_" (not "alice"/"bob") because this suite
    // runs in the same `test:integration` process as
    // templates/rls.integration.test.ts, which uses those bare tags — two
    // files calling signedInUser("alice") can land on the exact same
    // Date.now() millisecond when vitest runs files in parallel, producing
    // a genuine auth.users email collision (observed while writing this
    // suite). Distinct tags make the emails disjoint regardless of timing.
    alice = await signedInUser("program_alice");
    bob = await signedInUser("program_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "Alpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "Beta" });
    if (e2) throw e2;

    // Members may write templates directly (0003); the program fixture rides
    // on that, not on the RPC.
    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "RLS Program Fixture" })
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

  it("create_program rejects a foreign template", async () => {
    const { error } = await bob.rpc("create_program", {
      p_template_id: aliceTemplateId,
      p_name: "Intrusion Program",
    });
    expect(error).not.toBeNull();
  });

  it("create_program rejects a stage-less template", async () => {
    const { data: empty, error: insertError } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Empty" })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { error } = await alice.rpc("create_program", {
      p_template_id: (empty as { id: string }).id,
      p_name: "Should Fail",
    });
    expect(error).not.toBeNull();
  });

  it("create_program rejects a blank name", async () => {
    const { error } = await alice.rpc("create_program", {
      p_template_id: aliceTemplateId,
      p_name: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("create_program snapshots stages for the owner", async () => {
    const { data, error } = await alice.rpc("create_program", {
      p_template_id: aliceTemplateId,
      p_name: "R1",
    });
    expect(error).toBeNull();
    aliceProgramId = (data as { id: string }).id;

    const { data: stages } = await alice
      .from("program_stages")
      .select("name, position")
      .eq("program_id", aliceProgramId)
      .order("position");
    expect(stages!.map((s) => s.name)).toEqual(["S1", "S2"]);
    expect(stages!.map((s) => s.position)).toEqual([0, 1]);
  });

  it("direct insert into programs is denied even for one's own org", async () => {
    // RPC-only creation: locally this is stopped by RLS (no insert policy),
    // in CI by the GRANT (no insert grant at all) — both are errors, so a
    // plain error assertion is portable across environments.
    const { error } = await alice.from("programs").insert({ org_id: aliceOrgId, name: "direct" });
    expect(error).not.toBeNull();
  });

  it("program_stages is immutable for authenticated", async () => {
    // INSERT errors in both environments (RLS with-check violation locally,
    // permission-denied GRANT failure in CI), so a plain error assertion is
    // portable.
    const { error: insertError } = await alice.from("program_stages").insert({
      program_id: aliceProgramId,
      org_id: aliceOrgId,
      name: "Intrusion Stage",
      position: 99,
    });
    expect(insertError).not.toBeNull();

    // UPDATE/DELETE diverge: locally there is no update/delete POLICY on
    // program_stages, so the write silently matches 0 rows (error null);
    // in CI there is no update/delete GRANT either, so it fails outright
    // (error non-null). Assert only the effect — no rows changed — and
    // never assert on error for these two, so the same test is true in
    // both environments. Re-reading as the owner (alice, an org member who
    // can select) proves the row itself is untouched.
    const { data: before } = await alice
      .from("program_stages")
      .select("id, name")
      .eq("program_id", aliceProgramId)
      .order("position");
    const [updateTarget, deleteTarget] = before!;

    const { data: updateData } = await alice
      .from("program_stages")
      .update({ name: "Hijacked Stage" })
      .eq("id", updateTarget.id)
      .select();
    expect(updateData ?? []).toHaveLength(0);

    const { data: updateCheck } = await alice
      .from("program_stages")
      .select("name")
      .eq("id", updateTarget.id)
      .single();
    expect(updateCheck!.name).toBe(updateTarget.name);

    const { data: deleteData } = await alice
      .from("program_stages")
      .delete()
      .eq("id", deleteTarget.id)
      .select();
    expect(deleteData ?? []).toHaveLength(0);

    const { data: deleteCheck } = await alice
      .from("program_stages")
      .select("id")
      .eq("id", deleteTarget.id);
    expect(deleteCheck).toHaveLength(1);
  });

  it("foreign member sees no programs or units", async () => {
    const { data: programsSeen } = await bob.from("programs").select("id").eq("id", aliceProgramId);
    expect(programsSeen).toHaveLength(0);

    const { data: unitsSeen } = await bob
      .from("units")
      .select("id")
      .eq("program_id", aliceProgramId);
    expect(unitsSeen).toHaveLength(0);
  });

  it("foreign member cannot insert a unit into the program", async () => {
    const { error } = await bob.from("units").insert({
      program_id: aliceProgramId,
      org_id: aliceOrgId,
      name: "Intrusion Unit",
    });
    expect(error).not.toBeNull();
  });

  it("update/delete denial on programs and units", async () => {
    // Same reasoning as the templates suite: a filtered update/delete that
    // the USING clause hides matches 0 rows and returns no error, so the
    // proof is the pair — 0 rows affected here, and the value/row unchanged
    // when re-read as the owner below.
    const { data: programUpdateData, error: programUpdateError } = await bob
      .from("programs")
      .update({ name: "Hijacked Program" })
      .eq("id", aliceProgramId)
      .select();
    expect(programUpdateError).toBeNull();
    expect(programUpdateData).toHaveLength(0);

    const { data: programDeleteData, error: programDeleteError } = await bob
      .from("programs")
      .delete()
      .eq("id", aliceProgramId)
      .select();
    expect(programDeleteError).toBeNull();
    expect(programDeleteData).toHaveLength(0);

    const { data: programCheck } = await alice
      .from("programs")
      .select("name")
      .eq("id", aliceProgramId)
      .single();
    expect(programCheck!.name).toBe("R1");

    // units — alice creates one first so there is a real foreign row for
    // Bob to (fail to) hijack.
    const { data: unit, error: unitInsertError } = await alice
      .from("units")
      .insert({ program_id: aliceProgramId, org_id: aliceOrgId, name: "Store #1" })
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
    // program's frozen snapshot.
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

    const { data: program } = await alice
      .from("programs")
      .select("id, template_id")
      .eq("id", aliceProgramId)
      .single();
    expect(program).not.toBeNull();
    expect(program!.template_id).toBeNull();

    const { data: stagesAfter } = await alice
      .from("program_stages")
      .select("name")
      .eq("program_id", aliceProgramId)
      .order("position");
    expect(stagesAfter!.map((s) => s.name)).toEqual(["S1", "S2"]);
  });
});
