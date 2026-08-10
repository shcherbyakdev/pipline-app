/**
 * Photo evidence SQL surface (slice 8): record/delete_photo_evidence,
 * path-prefix + metadata caps, photo-aware derivation, photo guards on the
 * slice-7 RPCs, relaxed one-value CHECK, RLS/grants.
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

const CHECKSUM = "ab".repeat(32); // 64 hex chars

describe("photo evidence: record, delete, derivation, guards", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let programId: string;
  let stageId: string;
  let photoReqId: string; // required photo
  let boolReqId: string; // required boolean
  let textReqId: string; // OPTIONAL text (guard/reject fixture)
  let unit1: string; // assigned to P1
  let unit2: string; // assigned to P2
  let unit3: string; // assigned to NOBODY
  let p1: string;
  let p2: string;
  let t1: { token: string; tokenHash: string }; // program-scoped, P1
  let t2: { token: string; tokenHash: string }; // unit2-scoped, P2
  let evidenceA: string; // first photo id on unit1
  let pathA: string;
  let pathB: string;

  const record = (
    token: string,
    unitId: string,
    reqId: string,
    path: string,
    overrides: Record<string, unknown> = {},
  ) =>
    anon.rpc("record_photo_evidence", {
      p_token: token,
      p_unit_id: unitId,
      p_requirement_id: reqId,
      p_path: path,
      p_filename: "site.jpg",
      p_mime: "image/jpeg",
      p_size_bytes: 12345,
      p_checksum_sha256: CHECKSUM,
      ...overrides,
    });
  const del = (token: string, evidenceId: string) =>
    anon.rpc("delete_photo_evidence", { p_token: token, p_evidence_id: evidenceId });
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
  const stage = async () =>
    (
      await alice
        .from("unit_stages")
        .select("status, done_source")
        .eq("unit_id", unit1)
        .eq("program_stage_id", stageId)
        .single()
    ).data!;

  beforeAll(async () => {
    alice = await signedInUser("ev_alice");
    bob = await signedInUser("ev_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "EvAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "EvBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Ev Template" })
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
        type: "photo",
        label: "Site photo",
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
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "text",
        label: "Notes",
        required: false,
        config: {},
        position: 2,
      },
      // Optional photo: must never block derivation (spec test list).
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "photo",
        label: "Extra photo",
        required: false,
        config: {},
        position: 3,
      },
    ]);
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id,
      p_name: "Ev Program",
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
    photoReqId = reqs!.find((r) => r.label === "Site photo")!.id;
    boolReqId = reqs!.find((r) => r.label === "Safe")!.id;
    textReqId = reqs!.find((r) => r.label === "Notes")!.id;

    const { data: parts } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "P One" },
        { org_id: orgId, name: "P Two" },
      ])
      .select("id, name");
    p1 = parts!.find((p) => p.name === "P One")!.id;
    p2 = parts!.find((p) => p.name === "P Two")!.id;

    const mkUnit = async (name: string, assigned: string | null) =>
      (
        await alice
          .from("units")
          .insert({ program_id: programId, org_id: orgId, name, assigned_participant_id: assigned })
          .select("id")
          .single()
      ).data!.id as string;
    unit1 = await mkUnit("Unit 1", p1);
    unit2 = await mkUnit("Unit 2", p2);
    unit3 = await mkUnit("Unit 3", null);

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
    pathA = `${orgId}/${programId}/${unit1}/photo-a.jpg`;
    pathB = `${orgId}/${programId}/${unit1}/photo-b.jpg`;
  });

  it("records evidence with attribution and the all-null photo response", async () => {
    const { data, error } = await record(t1.token, unit1, photoReqId, pathA);
    expect(error).toBeNull();
    evidenceA = data as string;
    expect(evidenceA).toBeTruthy();

    const { data: ev } = await alice
      .from("evidence")
      .select(
        "path, filename, mime, size_bytes, checksum_sha256, response_id, uploaded_by_participant_id, uploaded_by_user_id, provider",
      )
      .eq("id", evidenceA)
      .single();
    expect(ev!.path).toBe(pathA);
    expect(ev!.checksum_sha256).toBe(CHECKSUM);
    expect(ev!.provider).toBe("supabase");
    expect(ev!.uploaded_by_participant_id).toBe(p1);
    expect(ev!.uploaded_by_user_id).toBeNull();
    expect(ev!.response_id).not.toBeNull();

    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("type, value_text, value_number, value_bool, value_date, answered_by_participant_id")
      .eq("id", ev!.response_id!)
      .single();
    expect(resp!.type).toBe("photo");
    expect(resp!.value_text).toBeNull();
    expect(resp!.value_number).toBeNull();
    expect(resp!.value_bool).toBeNull();
    expect(resp!.value_date).toBeNull();
    expect(resp!.answered_by_participant_id).toBe(p1);

    // Photo satisfied, but the required boolean isn't: still pending.
    expect((await stage()).status).toBe("pending");
  });

  it("a second photo reuses the response anchor", async () => {
    const { error } = await record(t1.token, unit1, photoReqId, pathB);
    expect(error).toBeNull();
    const { data: evs } = await alice
      .from("evidence")
      .select("id, response_id")
      .eq("unit_id", unit1);
    expect(evs).toHaveLength(2);
    expect(new Set(evs!.map((e) => e.response_id)).size).toBe(1);
    const { count } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(count).toBe(1);
  });

  it("rejects non-photo requirements, foreign paths, and bad metadata", async () => {
    const cases = [
      record(t1.token, unit1, boolReqId, pathA), // wrong type
      record(t1.token, unit1, textReqId, pathA), // wrong type (optional text)
      record(t1.token, unit1, photoReqId, `${orgId}/${programId}/${unit2}/x.jpg`), // foreign prefix
      record(t1.token, unit1, photoReqId, `evil/${unit1}/x.jpg`), // junk prefix
      record(t1.token, unit1, photoReqId, pathA, { p_mime: "application/pdf" }),
      record(t1.token, unit1, photoReqId, pathA, { p_size_bytes: 0 }),
      record(t1.token, unit1, photoReqId, pathA, { p_size_bytes: 15728641 }),
      record(t1.token, unit1, photoReqId, pathA, { p_checksum_sha256: "zz" }),
      record(t1.token, unit1, photoReqId, pathA, { p_filename: "x".repeat(201) }),
    ];
    for (const c of cases) {
      const { error } = await c;
      expect(error?.code).toBe("P0001");
    }
  });

  it("the core scope test: tokens cannot record or delete outside their scope", async () => {
    const { error: cross } = await record(
      t1.token,
      unit2,
      photoReqId,
      `${orgId}/${programId}/${unit2}/x.jpg`,
    );
    expect(cross?.code).toBe("P0001");
    const { error: cross2 } = await record(t2.token, unit1, photoReqId, pathA);
    expect(cross2?.code).toBe("P0001");
    const { error: unassigned } = await record(
      t1.token,
      unit3,
      photoReqId,
      `${orgId}/${programId}/${unit3}/x.jpg`,
    );
    expect(unassigned?.code).toBe("P0001");
    // Foreign delete: P2's token vs P1's evidence.
    const { error: crossDel } = await del(t2.token, evidenceA);
    expect(crossDel?.code).toBe("P0001");
  });

  it("submit and clear reject photo requirements (their own lifecycle)", async () => {
    const { error: eSubmit } = await submit(t1.token, unit1, photoReqId, {
      p_value_text: "not a photo",
    });
    expect(eSubmit?.code).toBe("P0001");
    const { error: eClear } = await anon.rpc("clear_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: photoReqId,
    });
    expect(eClear?.code).toBe("P0001");
  });

  it("photo counts in derivation; done locks record and delete", async () => {
    const { error } = await submit(t1.token, unit1, boolReqId, { p_value_bool: true });
    expect(error).toBeNull();
    // "Extra photo" (optional, zero uploads) must not block: done proves it.
    const s = await stage();
    expect(s.status).toBe("done");
    expect(s.done_source).toBe("requirements");

    const { error: locked } = await record(
      t1.token,
      unit1,
      photoReqId,
      `${orgId}/${programId}/${unit1}/late.jpg`,
    );
    expect(locked?.code).toBe("P0001");
    const { error: lockedDel } = await del(t1.token, evidenceA);
    expect(lockedDel?.code).toBe("P0001");
  });

  it("deleting the last photo removes the anchor and reopens the stage", async () => {
    // Reopen first (clear the boolean via its own lifecycle).
    const { error: eClear } = await anon.rpc("clear_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: boolReqId,
    });
    expect(eClear).toBeNull();
    expect((await stage()).status).toBe("pending");

    const { data: evs } = await alice
      .from("evidence")
      .select("id, path")
      .eq("unit_id", unit1)
      .order("created_at", { ascending: true });
    const [first, second] = evs!;

    // Non-last delete: anchor survives, returns the path.
    const { data: returnedPath, error: e1 } = await del(t1.token, second.id);
    expect(e1).toBeNull();
    expect(returnedPath).toBe(second.path);
    const { count: respCount } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(respCount).toBe(1);

    // Last delete: anchor goes too.
    const { error: e2 } = await del(t1.token, first.id);
    expect(e2).toBeNull();
    const { count: respCount2 } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(respCount2).toBe(0);
    const { count: evCount } = await alice
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1);
    expect(evCount).toBe(0);
  });

  it("scalar all-null is still rejected by the one-value CHECK", async () => {
    const { data: us } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", unit1)
      .eq("program_stage_id", stageId)
      .single();
    // Only the id pair — prepare fills type='text'; the CHECK must refuse.
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: us!.id,
      program_stage_requirement_id: textReqId,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // check_violation
  });

  it("RLS and grants: evidence is read-only for members, invisible cross-org, dead to anon", async () => {
    // Re-create one row so there is something to (not) see.
    const { error: eRec } = await record(t1.token, unit1, photoReqId, pathA);
    expect(eRec).toBeNull();

    const { data: mine } = await alice.from("evidence").select("id");
    expect(mine!.length).toBeGreaterThan(0);

    const { data: theirs, error: eBob } = await bob.from("evidence").select("id");
    expect(eBob).toBeNull();
    expect(theirs).toHaveLength(0); // RLS, not an error

    const { error: eAnon } = await anon.from("evidence").select("id");
    expect(eAnon).not.toBeNull();
    expect(eAnon!.code).toBe("42501"); // no grant at all

    const { error: eInsert } = await alice.from("evidence").insert({
      org_id: orgId,
      unit_id: unit1,
      unit_stage_id: (
        await alice
          .from("unit_stages")
          .select("id")
          .eq("unit_id", unit1)
          .eq("program_stage_id", stageId)
          .single()
      ).data!.id,
      path: `${orgId}/${programId}/${unit1}/forged.jpg`,
      filename: "forged.jpg",
      mime: "image/jpeg",
      size_bytes: 1,
      checksum_sha256: CHECKSUM,
    });
    expect(eInsert?.code).toBe("42501"); // members hold no insert grant

    const { error: eDelete } = await alice.from("evidence").delete().eq("unit_id", unit1);
    expect(eDelete?.code).toBe("42501"); // ...and no delete grant either

    const { error: eAuthRpc } = await alice.rpc("record_photo_evidence", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: photoReqId,
      p_path: pathA,
      p_filename: "site.jpg",
      p_mime: "image/jpeg",
      p_size_bytes: 1,
      p_checksum_sha256: CHECKSUM,
    });
    expect(eAuthRpc?.code).toBe("42501"); // anon-only EXECUTE

    const { error: eAuthDel } = await alice.rpc("delete_photo_evidence", {
      p_token: t1.token,
      p_evidence_id: evidenceA,
    });
    expect(eAuthDel?.code).toBe("42501");
  });

  // ---------- Hardening added after this brief was written (review of
  // 0015_evidence_security.sql): unique path index, per-response cap,
  // traversal rejection, and the unit_stage_id pin on photo satisfaction.
  // Each test below targets exactly one of those four guards.

  it("guard: a duplicate path fails at the unique index (23505), not the RPC's P0001 discipline", async () => {
    // pathA is already in use by the evidence row the previous test
    // created. A second row at the same path must die at evidence_path_uq
    // — a real Postgres unique_violation, not the RPC's uniform 'not found'.
    const { error } = await record(t1.token, unit1, photoReqId, pathA);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505"); // unique_violation
  });

  it("guard: caps evidence at 20 rows per response; the 21st is rejected with P0001", async () => {
    const { data: capUnit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit Cap", assigned_participant_id: p1 })
      .select("id")
      .single();
    const unitCap = capUnit!.id as string;

    for (let i = 0; i < 20; i++) {
      const { error } = await record(
        t1.token,
        unitCap,
        photoReqId,
        `${orgId}/${programId}/${unitCap}/cap-${i}.jpg`,
      );
      expect(error).toBeNull();
    }
    // The 21st, on a fresh distinct path (so evidence_path_uq cannot be
    // what rejects it), must hit the count(*) >= 20 backstop.
    const { error: capped } = await record(
      t1.token,
      unitCap,
      photoReqId,
      `${orgId}/${programId}/${unitCap}/cap-20.jpg`,
    );
    expect(capped?.code).toBe("P0001");

    const { count } = await alice
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unitCap);
    expect(count).toBe(20); // the rejected 21st left no row behind
  });

  it("guard: `..` traversal is rejected even though it satisfies the naive prefix check", async () => {
    // left(path, prefix_len) === prefix for this string — a naive prefix
    // check would let it through. Only the p_path !~ '\\.\\.' guard catches it.
    const { error } = await record(
      t1.token,
      unit1,
      photoReqId,
      `${orgId}/${programId}/${unit1}/../../elsewhere.jpg`,
    );
    expect(error?.code).toBe("P0001");
  });

  it("guard: photo satisfaction is pinned to the response's own unit_stage_id, not just response_id", async () => {
    // Two fresh units on the same program stage, both assigned to P1 so t1
    // (program-scoped) can drive both without minting new tokens.
    const { data: pinUnits } = await alice
      .from("units")
      .insert([
        { program_id: programId, org_id: orgId, name: "Unit Pin Target", assigned_participant_id: p1 },
        { program_id: programId, org_id: orgId, name: "Unit Pin Source", assigned_participant_id: p1 },
      ])
      .select("id, name");
    const unitTarget = pinUnits!.find((u) => u.name === "Unit Pin Target")!.id as string;
    const unitSource = pinUnits!.find((u) => u.name === "Unit Pin Source")!.id as string;

    // Target satisfies its boolean requirement but leaves photo unanswered:
    // whether its stage reads 'done' now hinges entirely on the photo.
    const { error: eBool } = await submit(t1.token, unitTarget, boolReqId, { p_value_bool: true });
    expect(eBool).toBeNull();

    // Source gets a real, valid photo of its own — response + evidence row
    // both correctly anchored to Source's unit_stage.
    const { error: eRec } = await record(
      t1.token,
      unitSource,
      photoReqId,
      `${orgId}/${programId}/${unitSource}/pin.jpg`,
    );
    expect(eRec).toBeNull();

    const { data: stages } = await alice
      .from("unit_stages")
      .select("id, unit_id")
      .eq("program_stage_id", stageId)
      .in("unit_id", [unitTarget, unitSource]);
    const usTarget = stages!.find((s) => s.unit_id === unitTarget)!.id as string;
    const usSource = stages!.find((s) => s.unit_id === unitSource)!.id as string;

    const { data: statusBefore } = await alice
      .from("unit_stages")
      .select("status")
      .eq("id", usTarget)
      .single();
    expect(statusBefore!.status).toBe("pending"); // bool satisfied, photo isn't: sanity check

    const { data: sourceResp } = await alice
      .from("unit_stage_responses")
      .select("id")
      .eq("unit_stage_id", usSource)
      .eq("program_stage_requirement_id", photoReqId)
      .single();

    // Staff hold a column grant on unit_stage_id (0011's upsert-repoint
    // idiom) — repoint Source's photo RESPONSE onto Target's unit_stage.
    // The evidence row is immutable and still carries unit_stage_id =
    // usSource: after this, response_id would match Target's repointed
    // response, but unit_stage_id would not.
    const { error: eRepoint } = await alice
      .from("unit_stage_responses")
      .update({ unit_stage_id: usTarget })
      .eq("id", sourceResp!.id);
    expect(eRepoint).toBeNull();

    // If satisfaction were keyed on response_id alone, Target would now
    // read 'done' on the strength of Source's photo (a foreign stage's
    // evidence). The unit_stage_id pin in derive_unit_stage's exists()
    // must keep it 'pending' — this is the assertion that fails if the
    // "and e.unit_stage_id = resp.unit_stage_id" clause is ever dropped.
    const { data: statusAfter } = await alice
      .from("unit_stages")
      .select("status, done_source")
      .eq("id", usTarget)
      .single();
    expect(statusAfter!.status).toBe("pending");
    expect(statusAfter!.done_source).toBeNull();
  });
});
