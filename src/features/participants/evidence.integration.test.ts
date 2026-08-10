/**
 * Photo evidence SQL surface (slice 8): record/delete_photo_evidence,
 * path-prefix + metadata caps, photo-aware derivation, photo guards on the
 * slice-7 RPCs, relaxed one-value CHECK, RLS/grants.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

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

// Direct-Postgres escape hatch (the requirements.integration.test.ts
// pattern) for two infra-only checks that no PostgREST client can reach:
// storage.buckets/pg_policies aren't exposed via the API schema at all, and
// there is no supabase-js method for TRUNCATE. Connects as the table owner
// (same DATABASE_URL drizzle-kit uses) and SET ROLEs to service_role only
// for the one assertion that needs to observe that role's own grants.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

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
  let extraPhotoReqId: string; // OPTIONAL photo — a second, independent response for cap isolation
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
    extraPhotoReqId = reqs!.find((r) => r.label === "Extra photo")!.id;

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

  afterAll(async () => {
    await sql.end();
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
    // Non-vacuity note: pathA is already a live duplicate at this point
    // (the two tests above recorded it). That means the mime/size/
    // checksum/filename cases below still bite if their SPECIFIC guard is
    // deleted — the insert would then proceed to evidence_path_uq (23505)
    // instead of stopping at the metadata check (P0001), and the loop's
    // strict `.toBe("P0001")` fails either way — but the failure reason
    // wouldn't isolate which guard broke. Don't swap pathA for a fresh,
    // unused path here without re-checking this.
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

  it("guard: the size cap and mime allowlist are exact, not merely 'accepts jpeg under ~15MB'", async () => {
    // Every success elsewhere in this file uses 12345 bytes / image/jpeg,
    // and the reject-side test above only proves 15728641 fails and
    // application/pdf fails. Together those pin the cap to "somewhere in
    // (12345, 15728641)" and the allowlist to "jpeg is in, pdf is out" —
    // narrowing the cap to 1MB or the allowlist to jpeg-only would leave
    // every existing assertion green.
    const { data: u } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit Boundaries", assigned_participant_id: p1 })
      .select("id")
      .single();
    const unitB = u!.id as string;

    const { error: atCap } = await record(
      t1.token,
      unitB,
      photoReqId,
      `${orgId}/${programId}/${unitB}/max-size.jpg`,
      { p_size_bytes: 15728640 },
    );
    expect(atCap).toBeNull();

    const mimes = ["image/png", "image/webp", "image/heic", "image/heif"];
    for (const [i, mime] of mimes.entries()) {
      const { error } = await record(
        t1.token,
        unitB,
        photoReqId,
        `${orgId}/${programId}/${unitB}/mime-${i}.jpg`,
        { p_mime: mime },
      );
      expect(error).toBeNull();
    }
  });

  it("the core scope test: tokens cannot record or delete outside their scope", async () => {
    // Prove t2 actually works before its rejections count as evidence of
    // anything: if the t2 access_tokens row were malformed (wrong hash,
    // wrong kind, bad expires_at), resolve_participant_token would return
    // not-ok and every assertion below would pass P0001 without ever
    // reaching the scope logic they claim to test.
    const { error: t2Works, data: t2Evidence } = await record(
      t2.token,
      unit2,
      photoReqId,
      `${orgId}/${programId}/${unit2}/t2-control.jpg`,
    );
    expect(t2Works).toBeNull();
    expect(t2Evidence).toBeTruthy();

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

  it("a unit-pinned token cannot reach a different unit belonging to the SAME participant (isolates the unit_id pin)", async () => {
    // Every t2 attack above is rejected by the ASSIGNMENT clause alone
    // (unit1 is P1's, unit2 is P2's) — none of them can tell whether
    // "(v_scope.unit_id is null or u.id = v_scope.unit_id)" is doing
    // anything. Give P2 a SECOND unit and attack it with t2 (pinned to
    // unit2): the assignment clause now agrees (both units are P2's), so
    // only the pin clause — present in both participant_scope_unit_stage
    // AND delete_photo_evidence's own inline duplicate (0015:278) — can
    // still reject it.
    const { data: u2b } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit 2b", assigned_participant_id: p2 })
      .select("id")
      .single();
    const unit2b = u2b!.id as string;

    // A program-scoped (not unit-pinned) token for P2 legitimately seeds
    // evidence on unit2b, so there is something for t2 to illegitimately
    // target with delete.
    const t2b = mint();
    const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { data: me } = await alice.auth.getUser();
    const { error: mintErr } = await alice.from("access_tokens").insert({
      org_id: orgId,
      token_hash: t2b.tokenHash,
      kind: "participant",
      participant_id: p2,
      program_id: programId,
      expires_at: in30d,
      created_by: me!.user!.id,
    });
    expect(mintErr).toBeNull();

    const { data: seededId, error: seedErr } = await record(
      t2b.token,
      unit2b,
      photoReqId,
      `${orgId}/${programId}/${unit2b}/seed.jpg`,
    );
    expect(seedErr).toBeNull();

    const { error: pinnedRecord } = await record(
      t2.token,
      unit2b,
      photoReqId,
      `${orgId}/${programId}/${unit2b}/attack.jpg`,
    );
    expect(pinnedRecord?.code).toBe("P0001");

    const { error: pinnedDelete } = await del(t2.token, seededId as string);
    expect(pinnedDelete?.code).toBe("P0001");
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

  it("a required photo blocks derivation on its own (not merely excluded, as pre-slice-8 0011 treated it)", async () => {
    // Isolate the semantic change on a fresh unit: only the boolean is
    // answered, the photo isn't. Under the old `r.type <> 'photo'`
    // exclusion a photo requirement never counted toward
    // v_required/v_satisfied at all, so this unit could read 'done' with
    // no photo ever uploaded. The test at "photo counts in derivation"
    // below only proves this incidentally (it answers the photo first),
    // so it would still pass under the old exclusion too.
    const { data: u } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit Photo Blocks", assigned_participant_id: p1 })
      .select("id")
      .single();
    const unitBlocks = u!.id as string;

    const { error } = await submit(t1.token, unitBlocks, boolReqId, { p_value_bool: true });
    expect(error).toBeNull();
    const { data: s } = await alice
      .from("unit_stages")
      .select("status")
      .eq("unit_id", unitBlocks)
      .eq("program_stage_id", stageId)
      .single();
    expect(s!.status).toBe("pending");
  });

  it("the evidence table's own AFTER trigger — not the response trigger — flips a stage to done when the photo is uploaded last", async () => {
    // record_photo_evidence upserts the response row BEFORE it inserts the
    // evidence row, so at response-trigger time (0011's
    // unit_stage_responses_derive) the photo requirement is still
    // unsatisfied — nothing in that trigger's own run can flip this stage.
    // Only evidence_derive (0015:160-162), firing AFTER the evidence
    // insert that follows, can. Every stage transition tested elsewhere in
    // this file is driven by the RESPONSE trigger (a boolean submit, or a
    // clear) — dropping evidence_derive entirely would leave all of them
    // green. This is also the ordinary real-world flow: answer the
    // scalars, upload the required photo last.
    const { data: u } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit Trigger", assigned_participant_id: p1 })
      .select("id")
      .single();
    const unitTrig = u!.id as string;

    const { error: eBool } = await submit(t1.token, unitTrig, boolReqId, { p_value_bool: true });
    expect(eBool).toBeNull();
    const { data: before } = await alice
      .from("unit_stages")
      .select("status")
      .eq("unit_id", unitTrig)
      .eq("program_stage_id", stageId)
      .single();
    expect(before!.status).toBe("pending"); // sanity: bool alone cannot satisfy

    const { error: eRec } = await record(
      t1.token,
      unitTrig,
      photoReqId,
      `${orgId}/${programId}/${unitTrig}/trigger.jpg`,
    );
    expect(eRec).toBeNull();

    const { data: after } = await alice
      .from("unit_stages")
      .select("status, done_source")
      .eq("unit_id", unitTrig)
      .eq("program_stage_id", stageId)
      .single();
    expect(after!.status).toBe("done");
    expect(after!.done_source).toBe("requirements");
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

    // The title's actual claim ("reopens the stage") — nothing above
    // checked stage status after either delete. Note this alone doesn't
    // isolate the delete-side trigger's necessity: the boolean was cleared
    // first, so the stage was already 'pending' before either delete, and
    // deleting the LAST evidence row also deletes its anchor response,
    // which independently re-triggers 0011's response-side derivation.
    // There is no way to isolate evidence_derive's necessity on the delete
    // path through the public RPCs alone, since the anchor always dies
    // together with the last evidence row.
    expect((await stage()).status).toBe("pending");
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
    // Re-create one row so there is something to (not) see. Non-vacuity
    // note: this succeeding (and `mine!.length` below being meaningful)
    // depends on the "deleting the last photo" test above having fully
    // freed pathA — if it stopped deleting both evidence rows, this would
    // 23505 instead, eRec would be non-null, and the assertion right below
    // would fail loudly rather than silently leaving `mine` empty.
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

  it("guard: caps evidence at 20 rows per response — not per unit — and the 21st is rejected with P0001", async () => {
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

    // A DIFFERENT requirement on the SAME unit has its own, independent
    // response and is nowhere near ITS cap: if the >=20 check were ever
    // re-scoped from response_id to unit_id, this would start failing too.
    const { error: extraOk } = await record(
      t1.token,
      unitCap,
      extraPhotoReqId,
      `${orgId}/${programId}/${unitCap}/extra.jpg`,
    );
    expect(extraOk).toBeNull();

    const { data: photoResp } = await alice
      .from("unit_stage_responses")
      .select("id")
      .eq("unit_id", unitCap)
      .eq("program_stage_requirement_id", photoReqId)
      .single();
    const { count } = await alice
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("response_id", photoResp!.id);
    expect(count).toBe(20); // scoped to THIS response, not the unit as a whole
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

    // A PostgREST PATCH matching zero rows also returns success with no
    // error (the same trap 0015:81-88 documents for DELETE) — eRepoint
    // being null does NOT by itself prove the repoint happened. Re-read
    // the row to confirm it actually moved.
    const { data: repointed } = await alice
      .from("unit_stage_responses")
      .select("unit_stage_id")
      .eq("id", sourceResp!.id)
      .single();
    expect(repointed!.unit_stage_id).toBe(usTarget);

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

  it("positive control: a repoint really does re-trigger derivation (so the pin test above isn't silently vacuous)", async () => {
    // The pin test's core assertion is that Target STAYS 'pending' after a
    // repoint. That is only meaningful evidence of the pin if repointing
    // actually re-triggers derive_unit_stage at all — otherwise "stays
    // pending" would be true for the trivial reason that nothing ever
    // recomputed anything. Prove the opposite case here: repoint a TRUE
    // boolean answer onto a stage whose photo is already satisfied, and
    // the stage MUST flip to done.
    const { data: ctrlUnits } = await alice
      .from("units")
      .insert([
        { program_id: programId, org_id: orgId, name: "Unit Pin Ctrl Bool", assigned_participant_id: p1 },
        { program_id: programId, org_id: orgId, name: "Unit Pin Ctrl Photo", assigned_participant_id: p1 },
      ])
      .select("id, name");
    const unitCtrlBool = ctrlUnits!.find((u) => u.name === "Unit Pin Ctrl Bool")!.id as string;
    const unitCtrlPhoto = ctrlUnits!.find((u) => u.name === "Unit Pin Ctrl Photo")!.id as string;

    const { error: eRec } = await record(
      t1.token,
      unitCtrlPhoto,
      photoReqId,
      `${orgId}/${programId}/${unitCtrlPhoto}/ctrl.jpg`,
    );
    expect(eRec).toBeNull();
    const { error: eBool } = await submit(t1.token, unitCtrlBool, boolReqId, { p_value_bool: true });
    expect(eBool).toBeNull();

    const { data: stages } = await alice
      .from("unit_stages")
      .select("id, unit_id, status")
      .eq("program_stage_id", stageId)
      .in("unit_id", [unitCtrlBool, unitCtrlPhoto]);
    const usCtrlBool = stages!.find((s) => s.unit_id === unitCtrlBool)!.id as string;
    const usCtrlPhoto = stages!.find((s) => s.unit_id === unitCtrlPhoto)!.id as string;
    expect(stages!.find((s) => s.unit_id === unitCtrlPhoto)!.status).toBe("pending"); // photo alone isn't enough

    const { data: boolResp } = await alice
      .from("unit_stage_responses")
      .select("id")
      .eq("unit_stage_id", usCtrlBool)
      .eq("program_stage_requirement_id", boolReqId)
      .single();

    // Repoint the TRUE boolean answer onto the photo-satisfied stage. If
    // repointing didn't re-trigger derive_unit_stage at all, this stage
    // would stay 'pending' forever regardless of any guard — exactly the
    // silent-vacuity failure mode the pin test above needs to be immune to.
    const { error: eRepoint } = await alice
      .from("unit_stage_responses")
      .update({ unit_stage_id: usCtrlPhoto })
      .eq("id", boolResp!.id);
    expect(eRepoint).toBeNull();

    const { data: after } = await alice
      .from("unit_stages")
      .select("status, done_source")
      .eq("id", usCtrlPhoto)
      .single();
    expect(after!.status).toBe("done");
    expect(after!.done_source).toBe("requirements");
  });

  it("infra: the evidence bucket is private, capped, and has zero storage policies", async () => {
    const [bucket] = await sql<
      { public: boolean; file_size_limit: string; allowed_mime_types: string[] }[]
    >`
      select public, file_size_limit, allowed_mime_types
        from storage.buckets where id = 'evidence'
    `;
    expect(bucket).toBeTruthy();
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(15728640);
    expect(bucket.allowed_mime_types).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);

    // "ZERO storage policies" is the migration's own claim (0015:8): a
    // policy referencing this bucket in USING or WITH CHECK would be a
    // second, RLS-shaped door into objects that the definer RPCs are
    // supposed to be the only way through.
    const bucketPolicies = await sql<{ policyname: string }[]>`
      select policyname from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and (qual ilike '%evidence%' or with_check ilike '%evidence%')
    `;
    expect(bucketPolicies).toHaveLength(0);
  });

  it("infra: service_role is select-only on evidence — matches the client roles, not a backdoor", async () => {
    const { error: eSelect } = await admin.from("evidence").select("id").limit(1);
    expect(eSelect).toBeNull();

    const { data: anyUS } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", unit1)
      .eq("program_stage_id", stageId)
      .single();
    const { error: eInsert } = await admin.from("evidence").insert({
      org_id: orgId,
      unit_id: unit1,
      unit_stage_id: anyUS!.id,
      path: `${orgId}/${programId}/${unit1}/service-role-forged.jpg`,
      filename: "forged.jpg",
      mime: "image/jpeg",
      size_bytes: 1,
      checksum_sha256: CHECKSUM,
    });
    expect(eInsert?.code).toBe("42501");

    const { error: eUpdate } = await admin
      .from("evidence")
      .update({ filename: "x" })
      .eq("unit_id", unit1);
    expect(eUpdate?.code).toBe("42501");

    const { error: eDelete } = await admin.from("evidence").delete().eq("unit_id", unit1);
    expect(eDelete?.code).toBe("42501");

    // TRUNCATE has no supabase-js client surface at all, so this checks it
    // the only way available: assume the role directly over the raw
    // connection and watch Postgres itself refuse it — 0015 revokes
    // truncate from service_role explicitly, not just insert/update/delete.
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role service_role`;
        await tx`truncate table public.evidence`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
