/**
 * Fan-out + toggle + tenant-isolation proof for unit_stages, mirroring
 * rls.integration.test.ts. Requires the local Supabase stack (npm run setup).
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

describe("RLS unit_stages", () => {
  // ORDER-DEPENDENT it blocks (vitest default file order): the first test
  // creates the unit whose fan-out rows every later test consumes, and the
  // last test deletes that unit. Do not reorder or mark concurrent.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceProgramId: string;
  let aliceUnitId: string;
  let stageIds: string[] = [];
  let firstUnitStageId: string;

  beforeAll(async () => {
    // "progress_" tags keep emails disjoint from the other integration
    // suites running in the same process (Date.now() collision lesson).
    alice = await signedInUser("progress_alice");
    bob = await signedInUser("progress_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ProgAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "ProgBeta" });
    if (e2) throw e2;

    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Progress Fixture" })
      .select("id")
      .single();
    if (e3) throw e3;
    const templateId = (template as { id: string }).id;

    const stages = ["S1", "S2"].map((name, position) => ({
      template_id: templateId,
      org_id: aliceOrgId,
      name,
      position,
    }));
    const { error: e4 } = await alice.from("template_stages").insert(stages);
    if (e4) throw e4;

    const { data: program, error: e5 } = await alice.rpc("create_program", {
      p_template_id: templateId,
      p_name: "Progress R1",
    });
    if (e5) throw e5;
    aliceProgramId = (program as { id: string }).id;

    const { data: programStages, error: e6 } = await alice
      .from("program_stages")
      .select("id")
      .eq("program_id", aliceProgramId)
      .order("position");
    if (e6) throw e6;
    stageIds = (programStages ?? []).map((s) => s.id);
  });

  it("inserting a unit fans out one pending row per stage", async () => {
    const { data: unit, error } = await alice
      .from("units")
      .insert({ program_id: aliceProgramId, org_id: aliceOrgId, name: "U1" })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceUnitId = (unit as { id: string }).id;

    const { data: rows } = await alice
      .from("unit_stages")
      .select("id, program_stage_id, program_id, org_id, status, done_at")
      .eq("unit_id", aliceUnitId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows!.map((r) => r.program_stage_id))).toEqual(new Set(stageIds));
    for (const row of rows!) {
      expect(row.status).toBe("pending");
      expect(row.done_at).toBeNull();
      expect(row.program_id).toBe(aliceProgramId);
      expect(row.org_id).toBe(aliceOrgId);
    }
    firstUnitStageId = rows!.find((r) => r.program_stage_id === stageIds[0])!.id;
  });

  it("owner toggles done and back; done_at follows", async () => {
    const { data: doneRow, error: doneError } = await alice
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", firstUnitStageId)
      .select("status, done_at")
      .single();
    expect(doneError).toBeNull();
    expect(doneRow!.status).toBe("done");
    expect(doneRow!.done_at).not.toBeNull();

    const { data: pendingRow, error: pendingError } = await alice
      .from("unit_stages")
      .update({ status: "pending" })
      .eq("id", firstUnitStageId)
      .select("status, done_at")
      .single();
    expect(pendingError).toBeNull();
    expect(pendingRow!.status).toBe("pending");
    expect(pendingRow!.done_at).toBeNull();
  });

  it("rejects a status outside the CHECK list", async () => {
    const { error } = await alice
      .from("unit_stages")
      .update({ status: "bogus" })
      .eq("id", firstUnitStageId);
    expect(error).not.toBeNull();
  });

  it("direct insert into unit_stages is denied even for one's own org", async () => {
    // System-managed rows: no insert policy locally, no insert grant in CI —
    // both are errors, so a plain error assertion is portable.
    const { error } = await alice.from("unit_stages").insert({
      unit_id: aliceUnitId,
      program_stage_id: stageIds[0],
      program_id: aliceProgramId,
      org_id: aliceOrgId,
    });
    expect(error).not.toBeNull();
  });

  it("delete is denied (asserted by effect — local/CI ACLs diverge)", async () => {
    const { data: deleteData } = await alice
      .from("unit_stages")
      .delete()
      .eq("id", firstUnitStageId)
      .select();
    expect(deleteData ?? []).toHaveLength(0);

    const { data: stillThere } = await alice
      .from("unit_stages")
      .select("id")
      .eq("id", firstUnitStageId);
    expect(stillThere).toHaveLength(1);
  });

  it("foreign member sees nothing and cannot update", async () => {
    const { data: seen } = await bob
      .from("unit_stages")
      .select("id")
      .eq("program_id", aliceProgramId);
    expect(seen).toHaveLength(0);

    const { data: updateData, error: updateError } = await bob
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", firstUnitStageId)
      .select();
    expect(updateError).toBeNull();
    expect(updateData).toHaveLength(0);

    const { data: check } = await alice
      .from("unit_stages")
      .select("status")
      .eq("id", firstUnitStageId)
      .single();
    expect(check!.status).toBe("pending");
  });

  it("deleting the unit cascades its unit_stages rows", async () => {
    const { error } = await alice.from("units").delete().eq("id", aliceUnitId);
    expect(error).toBeNull();

    const { data: rows } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", aliceUnitId);
    expect(rows).toHaveLength(0);
  });
});
