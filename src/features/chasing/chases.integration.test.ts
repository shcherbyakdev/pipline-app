/**
 * Chasing security core (slice 10, task 2): RLS, grants, partial unique
 * index, org-guard trigger, and the three chase RPCs (mint_chase_token,
 * complete_chase, stop_chase).
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

describe("chases: RLS, grants, guard, RPCs", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let bobOrgId: string;
  let programId: string;
  let unitId: string;
  let participantId: string;
  let userId: string;
  let chaseId: string;

  beforeAll(async () => {
    alice = await signedInUser("chase_alice");
    bob = await signedInUser("chase_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "ChaseAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: bOrg, error: e2 } = await bob.rpc("create_org", { p_name: "ChaseBeta" });
    if (e2) throw e2;
    bobOrgId = (bOrg as { id: string }).id;
    const { data: me } = await alice.auth.getUser();
    userId = me.user!.id;
    // `programs` has no insert policy — programs are created only via the
    // create_program RPC (copy-on-use snapshot), which requires a template
    // with at least one stage. Mirrors tokens.integration.test.ts's beforeAll.
    const { data: template } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Chase Template" })
      .select("id")
      .single();
    await alice
      .from("template_stages")
      .insert({ template_id: template!.id, org_id: orgId, name: "Stage 1", position: 0 });
    const { data: prog, error: progErr } = await alice.rpc("create_program", {
      p_template_id: template!.id,
      p_name: "Chase Program",
    });
    if (progErr) throw progErr;
    programId = (prog as { id: string }).id;
    const { data: unit } = await alice
      .from("units")
      .insert({ org_id: orgId, program_id: programId, name: "Site 1" })
      .select("id")
      .single();
    unitId = unit!.id;
    const { data: p } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Dave", email: "dave@example.com" })
      .select("id")
      .single();
    participantId = p!.id;
  });

  it("member can insert a chase in their org", async () => {
    const { data, error } = await alice
      .from("chases")
      .insert({
        org_id: orgId,
        participant_id: participantId,
        program_id: programId,
        unit_id: unitId,
        // Future-dated on purpose: this fixture's unit is never assigned to
        // a participant, so a REAL drain would see "no outstanding work"
        // and complete_chase it. next_send_at = now would make this chase
        // live-and-due for the whole file's lifetime, which a concurrently
        // running drain.integration.test.ts (table-wide due-scan, full
        // suite) can and did pick up mid-file. Future-dating keeps it out
        // of every due-scan without changing what this file asserts.
        next_send_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    chaseId = data!.id;
  });

  it("partial unique index rejects a duplicate LIVE chase for the same scope", async () => {
    const { error } = await alice.from("chases").insert({
      org_id: orgId,
      participant_id: participantId,
      program_id: programId,
      unit_id: unitId,
      next_send_at: new Date().toISOString(),
      created_by: userId,
    });
    expect(error?.code).toBe("23505");
  });

  it("foreign org cannot see the chase", async () => {
    const { data } = await bob.from("chases").select("id").eq("id", chaseId);
    expect(data).toEqual([]);
  });

  it("org-guard trigger rejects a cross-org scope tuple", async () => {
    // Bob tries to reference Alice's participant/program from HIS org row.
    const { error } = await bob.from("chases").insert({
      org_id: bobOrgId,
      participant_id: participantId,
      program_id: programId,
      created_by: userId,
    });
    expect(error).not.toBeNull();
  });

  it("anon has zero access to chases", async () => {
    const { error } = await anon.from("chases").select("id").limit(1);
    expect(error).not.toBeNull();
  });

  it("mint_chase_token: service_role mints a token scoped from the chase", async () => {
    const { tokenHash } = mint();
    const { error } = await admin.rpc("mint_chase_token", {
      p_chase_id: chaseId,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(error).toBeNull();
    const { data: tok } = await admin
      .from("access_tokens")
      .select("kind, org_id, participant_id, program_id, unit_id, chase_id, created_by")
      .eq("token_hash", tokenHash)
      .single();
    expect(tok).toMatchObject({
      kind: "participant",
      org_id: orgId,
      participant_id: participantId,
      program_id: programId,
      unit_id: unitId,
      chase_id: chaseId,
      created_by: userId,
    });
  });

  it("mint_chase_token is NOT callable by anon or authenticated", async () => {
    const { tokenHash } = mint();
    const args = {
      p_chase_id: chaseId,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const { error: anonErr } = await anon.rpc("mint_chase_token", args);
    expect(anonErr).not.toBeNull();
    const { error: authErr } = await alice.rpc("mint_chase_token", args);
    expect(authErr).not.toBeNull();
  });

  it("stop_chase: a valid chase token sets stopped_at; garbage is silent", async () => {
    const t = mint();
    await admin.rpc("mint_chase_token", {
      p_chase_id: chaseId,
      p_token_hash: t.tokenHash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const { error: garbageErr } = await anon.rpc("stop_chase", { p_token: "not-a-real-token-aaaaaaaa" });
    expect(garbageErr).toBeNull(); // uniform silence
    let { data: c } = await admin.from("chases").select("stopped_at").eq("id", chaseId).single();
    expect(c!.stopped_at).toBeNull();
    const { error } = await anon.rpc("stop_chase", { p_token: t.token });
    expect(error).toBeNull();
    ({ data: c } = await admin.from("chases").select("stopped_at").eq("id", chaseId).single());
    expect(c!.stopped_at).not.toBeNull();
  });

  it("a member cannot update columns outside the stopped_at grant", async () => {
    // Column-scoped grant check: the table-wide UPDATE must be revoked, or
    // this passes vacuously regardless of what the column grant says.
    const { error: e1 } = await alice
      .from("chases")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", chaseId);
    expect(e1).not.toBeNull();
    const { error: e2 } = await alice.from("chases").update({ sends_done: 99 }).eq("id", chaseId);
    expect(e2).not.toBeNull();
  });

  it("complete_chase revokes exactly the chase's tokens, not hand-issued ones", async () => {
    // Un-stop so completion is meaningful for this test scope.
    await admin.from("chases").update({ stopped_at: null }).eq("id", chaseId);
    // Hand-issued token (no chase_id), minted by the member as usual.
    const hand = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId,
      token_hash: hand.tokenHash,
      kind: "participant",
      participant_id: participantId,
      program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: userId,
    });
    const { error } = await admin.rpc("complete_chase", { p_chase_id: chaseId });
    expect(error).toBeNull();
    const { data: c } = await admin.from("chases").select("completed_at").eq("id", chaseId).single();
    expect(c!.completed_at).not.toBeNull();
    const { data: chaseToks } = await admin
      .from("access_tokens")
      .select("revoked_at")
      .eq("chase_id", chaseId);
    for (const t of chaseToks!) expect(t.revoked_at).not.toBeNull();
    const { data: handTok } = await admin
      .from("access_tokens")
      .select("revoked_at")
      .eq("token_hash", hand.tokenHash)
      .single();
    expect(handTok!.revoked_at).toBeNull();
  });

  it("mint_chase_token refuses a completed chase", async () => {
    // chaseId is completed by the previous test — the live-chase check
    // must reject minting against it.
    const { tokenHash } = mint();
    const { error } = await admin.rpc("mint_chase_token", {
      p_chase_id: chaseId,
      p_token_hash: tokenHash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
