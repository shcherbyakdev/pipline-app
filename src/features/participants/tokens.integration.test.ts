/**
 * Participant token security core (slice 7, task 2): mint via access_tokens,
 * resolve_participant_token, submit/clear_participant_response, guard
 * triggers, and attribution symmetry with staff writes.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

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

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

function mint(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

type Resolved = {
  status: "ok" | "expired" | "revoked";
  org_name: string;
  participant_id: string;
  program_id: string;
  unit_id: string | null;
};

describe("participant tokens: mint, resolve, scope, attribution", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let programId: string;
  let stageId: string; // the single program stage
  let textReqId: string;
  let boolReqId: string;
  let unit1: string; // assigned to P1
  let unit2: string; // assigned to P2
  let p1: string;
  let p2: string;
  let t1: { token: string; tokenHash: string }; // program-scoped, P1
  let t2: { token: string; tokenHash: string }; // unit2-scoped, P2

  const resolve = async (token: string) =>
    anon.rpc("resolve_participant_token", { p_token: token });
  const submit = (token: string, unitId: string, reqId: string, cols: Record<string, unknown>) =>
    anon.rpc("submit_participant_response", {
      p_token: token,
      p_unit_id: unitId,
      p_requirement_id: reqId,
      p_value_text: null,
      p_value_number: null,
      p_value_bool: null,
      p_value_date: null,
      ...cols,
    });

  beforeAll(async () => {
    alice = await signedInUser("tok_alice");
    bob = await signedInUser("tok_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "TokAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "TokBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Tok Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    await alice.from("template_stage_requirements").insert([
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "text",
        label: "Notes",
        required: true,
        config: {},
        position: 0,
      },
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "boolean",
        label: "Safe",
        required: true,
        config: {},
        position: 1,
      },
    ]);
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id,
      p_name: "Tok Program",
    });
    if (e3) throw e3;
    programId = (program as { id: string }).id;
    const { data: pStages } = await alice
      .from("program_stages")
      .select("id")
      .eq("program_id", programId);
    stageId = pStages![0].id;
    const { data: reqs } = await alice
      .from("program_stage_requirements")
      .select("id, label")
      .eq("program_id", programId);
    textReqId = reqs!.find((r) => r.label === "Notes")!.id;
    boolReqId = reqs!.find((r) => r.label === "Safe")!.id;

    const { data: parts } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "P One", email: "p1@example.com" },
        { org_id: orgId, name: "P Two" },
      ])
      .select("id, name");
    p1 = parts!.find((p) => p.name === "P One")!.id;
    p2 = parts!.find((p) => p.name === "P Two")!.id;

    const { data: u1 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit 1", assigned_participant_id: p1 })
      .select("id")
      .single();
    unit1 = u1!.id;
    const { data: u2 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit 2", assigned_participant_id: p2 })
      .select("id")
      .single();
    unit2 = u2!.id;

    t1 = mint();
    t2 = mint();
    const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { data: me } = await alice.auth.getUser();
    const { error: mintError } = await alice.from("access_tokens").insert([
      {
        org_id: orgId,
        token_hash: t1.tokenHash,
        kind: "participant",
        participant_id: p1,
        program_id: programId,
        expires_at: in30d,
        created_by: me!.user!.id,
      },
      {
        org_id: orgId,
        token_hash: t2.tokenHash,
        kind: "participant",
        participant_id: p2,
        program_id: programId,
        unit_id: unit2,
        expires_at: in30d,
        created_by: me!.user!.id,
      },
    ]);
    if (mintError) throw mintError;
  });

  it("resolves a valid token with names; unknown returns zero rows", async () => {
    const { data, error } = await resolve(t1.token);
    expect(error).toBeNull();
    const rows = data as Resolved[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].org_name).toBe("TokAlpha");
    expect(rows[0].participant_id).toBe(p1);
    expect(rows[0].unit_id).toBeNull();

    const { data: none } = await resolve(mint().token);
    expect(none).toHaveLength(0);
  });

  it("touches last_used_at on resolve", async () => {
    const { data } = await alice
      .from("access_tokens")
      .select("last_used_at")
      .eq("token_hash", t1.tokenHash)
      .single();
    expect(data!.last_used_at).not.toBeNull();
  });

  it("reports expired and revoked distinctly", async () => {
    const old = mint();
    const { data: me } = await alice.auth.getUser();
    await alice.from("access_tokens").insert({
      org_id: orgId,
      token_hash: old.tokenHash,
      kind: "participant",
      participant_id: p1,
      program_id: programId,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      created_by: me!.user!.id,
    });
    const { data: exp } = await resolve(old.token);
    expect((exp as Resolved[])[0].status).toBe("expired");
    expect((exp as Resolved[])[0].org_name).toBe("TokAlpha");
  });

  it("cross-org mint is rejected by the guard trigger", async () => {
    const { data: bobOrg } = await bob.from("orgs").select("id").single();
    const { data: me } = await bob.auth.getUser();
    // Bob binds his own org_id to Alice's program/participant.
    const { error } = await bob.from("access_tokens").insert({
      org_id: bobOrg!.id,
      token_hash: mint().tokenHash,
      kind: "participant",
      participant_id: p1,
      program_id: programId,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      created_by: me!.user!.id,
    });
    expect(error).not.toBeNull();
  });

  it("cross-org unit assignment is rejected by the guard trigger", async () => {
    // Bob creates his own unit fixture, then tries to assign Alice's participant.
    const { data: bt } = await bob
      .from("templates")
      .insert({
        org_id: (await bob.from("orgs").select("id").single()).data!.id,
        name: "B T",
      })
      .select("id, org_id")
      .single();
    await bob
      .from("template_stages")
      .insert({ template_id: bt!.id, org_id: bt!.org_id, name: "S", position: 0 });
    const { data: bp } = await bob.rpc("create_program", { p_template_id: bt!.id, p_name: "B P" });
    const { error } = await bob.from("units").insert({
      program_id: (bp as { id: string }).id,
      org_id: bt!.org_id,
      name: "B U",
      assigned_participant_id: p1,
    });
    expect(error).not.toBeNull();
  });

  it("submit writes with participant attribution and drives derivation", async () => {
    const { error: e1 } = await submit(t1.token, unit1, textReqId, { p_value_text: "All good" });
    expect(e1).toBeNull();
    const { error: e2 } = await submit(t1.token, unit1, boolReqId, { p_value_bool: true });
    expect(e2).toBeNull();

    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", textReqId)
      .single();
    expect(resp!.answered_by_participant_id).toBe(p1);
    expect(resp!.answered_by_user_id).toBeNull();

    const { data: us } = await alice
      .from("unit_stages")
      .select("status, done_source")
      .eq("unit_id", unit1)
      .eq("program_stage_id", stageId)
      .single();
    expect(us!.status).toBe("done");
    expect(us!.done_source).toBe("requirements");
  });

  it("the core scope test: a token cannot touch a unit outside its scope", async () => {
    // P1's program-scoped token vs unit2 (assigned to P2)
    const { error: cross } = await submit(t1.token, unit2, textReqId, { p_value_text: "x" });
    expect(cross).not.toBeNull();
    // P2's unit2-scoped token vs unit1
    const { error: cross2 } = await submit(t2.token, unit1, textReqId, { p_value_text: "x" });
    expect(cross2).not.toBeNull();
  });

  it("reassignment kills scope", async () => {
    await alice.from("units").update({ assigned_participant_id: null }).eq("id", unit2);
    const { error } = await submit(t2.token, unit2, textReqId, { p_value_text: "x" });
    expect(error).not.toBeNull();
    await alice.from("units").update({ assigned_participant_id: p2 }).eq("id", unit2);
  });

  it("staff re-answer flips attribution (symmetry)", async () => {
    const { error } = await alice.from("unit_stage_responses").upsert(
      {
        unit_stage_id: (
          await alice
            .from("unit_stages")
            .select("id")
            .eq("unit_id", unit1)
            .eq("program_stage_id", stageId)
            .single()
        ).data!.id,
        program_stage_requirement_id: textReqId,
        value_text: "Staff correction",
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    );
    expect(error).toBeNull();
    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", textReqId)
      .single();
    expect(resp!.answered_by_user_id).not.toBeNull();
    expect(resp!.answered_by_participant_id).toBeNull();
  });

  it("participant re-answer flips it back", async () => {
    const { error } = await submit(t1.token, unit1, textReqId, { p_value_text: "Participant again" });
    expect(error).toBeNull();
    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", textReqId)
      .single();
    expect(resp!.answered_by_participant_id).toBe(p1);
    expect(resp!.answered_by_user_id).toBeNull();
  });

  it("clear removes the response and reopens the stage", async () => {
    const { error } = await anon.rpc("clear_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: boolReqId,
    });
    expect(error).toBeNull();
    const { data: us } = await alice
      .from("unit_stages")
      .select("status")
      .eq("unit_id", unit1)
      .eq("program_stage_id", stageId)
      .single();
    expect(us!.status).toBe("pending");
  });

  it("a revoked token stops working mid-session", async () => {
    await alice
      .from("access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", t2.tokenHash);
    const { data: r } = await resolve(t2.token);
    expect((r as Resolved[])[0].status).toBe("revoked");
    const { error } = await submit(t2.token, unit2, textReqId, { p_value_text: "x" });
    expect(error).not.toBeNull();
  });

  it("authenticated cannot execute the write RPCs; staff cannot set participant attribution; anon has no table access", async () => {
    const { error: e1 } = await alice.rpc("submit_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: textReqId,
      p_value_text: "hijack",
      p_value_number: null,
      p_value_bool: null,
      p_value_date: null,
    });
    expect(e1).not.toBeNull();

    const { error: e2 } = await alice.from("unit_stage_responses").upsert(
      {
        unit_stage_id: (
          await alice
            .from("unit_stages")
            .select("id")
            .eq("unit_id", unit1)
            .eq("program_stage_id", stageId)
            .single()
        ).data!.id,
        program_stage_requirement_id: textReqId,
        value_text: "x",
        answered_by_participant_id: p1,
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    );
    expect(e2).not.toBeNull(); // no column grant

    const { data: leak, error: e3 } = await anon.from("access_tokens").select("id");
    expect(e3 !== null || (leak ?? []).length === 0).toBe(true);
    const { data: leak2, error: e4 } = await anon.from("unit_stage_responses").select("id");
    expect(e4 !== null || (leak2 ?? []).length === 0).toBe(true);
  });
});
