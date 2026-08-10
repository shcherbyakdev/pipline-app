/**
 * Reader scope (slice 7, final review I3). The readers in @/lib/tokens run on
 * the SERVICE-ROLE client and therefore bypass RLS completely — their
 * org/program/assignment/unit-pin filters are the *only* thing separating one
 * participant from another's data. The SQL suite proves the write path; this
 * proves the read path, against real minted tokens resolved through the real
 * RPC (no hand-built scope objects, which would test nothing).
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { TokenScope } from "@/lib/tokens";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic import, deliberately AFTER loadEnvFile: @/lib/tokens pulls in
// @/env, which validates process.env at module-evaluation time. A static
// import is hoisted above the env load and would fail that validation.
// (`import type` above is erased, so it costs nothing at runtime.)
const { resolveParticipantToken, getParticipantUnits, getParticipantUnitDetail, generateParticipantToken } =
  await import("@/lib/tokens");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Direct-Postgres escape hatch (the requirements.integration.test.ts /
// evidence.integration.test.ts pattern): `public.evidence` is written ONLY
// by the definer RPCs — neither `authenticated` nor `service_role` holds
// insert on it (0015 deliberately revokes it). The describe block below
// seeds evidence rows directly to drive the TypeScript photo-mapping logic
// in getParticipantUnitDetail (bucketing, ordering, orphan-skipping,
// uploader resolution) — behavior no existing test asserts on. Connects as
// the table owner, the same DATABASE_URL drizzle-kit itself uses.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rd_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("token-scoped readers", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let programId: string;
  let p1: string;
  let p2: string;
  let unit1: string; // assigned to P1
  let unit2: string; // assigned to P2
  let unit3: string; // assigned to NOBODY
  let p1Scope: TokenScope; // program-scoped token for P1
  let p2Scope: TokenScope; // token pinned to unit2 for P2

  beforeAll(async () => {
    alice = await signedInUser("alice");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RdAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Rd Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    const { error: reqError } = await alice.from("template_stage_requirements").insert({
      template_stage_id: s!.id,
      org_id: orgId,
      type: "text",
      label: "Notes",
      required: true,
      config: {},
      position: 0,
    });
    if (reqError) throw reqError;

    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: t!.id,
      p_name: "Rd Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    const { data: parts, error: e3 } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "R One" },
        { org_id: orgId, name: "R Two" },
      ])
      .select("id, name");
    if (e3) throw e3;
    p1 = parts!.find((p) => p.name === "R One")!.id;
    p2 = parts!.find((p) => p.name === "R Two")!.id;

    const { data: units, error: e4 } = await alice
      .from("units")
      .insert([
        { program_id: programId, org_id: orgId, name: "RU 1", assigned_participant_id: p1 },
        { program_id: programId, org_id: orgId, name: "RU 2", assigned_participant_id: p2 },
        { program_id: programId, org_id: orgId, name: "RU 3", assigned_participant_id: null },
      ])
      .select("id, name");
    if (e4) throw e4;
    unit1 = units!.find((u) => u.name === "RU 1")!.id;
    unit2 = units!.find((u) => u.name === "RU 2")!.id;
    unit3 = units!.find((u) => u.name === "RU 3")!.id;

    // Real tokens, real hashes, real RPC resolution — the scope objects under
    // test are whatever the production chokepoint actually produces.
    const t1 = generateParticipantToken();
    const t2 = generateParticipantToken();
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

    const r1 = await resolveParticipantToken(t1.token, "readers-test");
    if (r1.status !== "ok") throw new Error(`P1 token did not resolve: ${r1.status}`);
    p1Scope = r1.scope;
    const r2 = await resolveParticipantToken(t2.token, "readers-test");
    if (r2.status !== "ok") throw new Error(`P2 token did not resolve: ${r2.status}`);
    p2Scope = r2.scope;

    expect(p1Scope.unitId).toBeNull();
    expect(p2Scope.unitId).toBe(unit2);
  });

  it("lists only the units assigned to the token's participant", async () => {
    const units = await getParticipantUnits(p1Scope);
    expect(units.map((u) => u.id)).toEqual([unit1]);
  });

  it("a program-scoped token cannot read another participant's unit", async () => {
    expect(await getParticipantUnitDetail(p1Scope, unit2)).toBeNull();
  });

  it("a program-scoped token cannot read an unassigned unit", async () => {
    // Same program, same org, genuinely nobody's — the assignment filter is
    // what rejects it, not the unit pin (this token has none).
    expect(await getParticipantUnitDetail(p1Scope, unit3)).toBeNull();
  });

  it("a unit-pinned token cannot read outside its pin", async () => {
    expect(await getParticipantUnitDetail(p2Scope, unit1)).toBeNull();
  });

  it("a unit-pinned token reads its own unit, with stages", async () => {
    const detail = await getParticipantUnitDetail(p2Scope, unit2);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(unit2);
    expect(detail!.stages.length).toBeGreaterThan(0);
    expect(detail!.stages[0].requirements.map((r) => r.label)).toContain("Notes");
  });
});

/**
 * Coverage gap (slice 8 review): no existing test asserts on the `photos`
 * array getParticipantUnitDetail builds from raw `evidence` rows — earlier
 * suites insert evidence only to exercise the SQL derivation trigger. This
 * block seeds evidence directly (the requirements.integration.test.ts /
 * evidence.integration.test.ts direct-Postgres pattern — service_role and
 * `authenticated` both lack insert on `evidence` by design) and asserts on
 * the TypeScript mapping itself: bucketing by requirement, orphan-skipping,
 * created_at ordering, uploader-name resolution, and the signed-URL degrade
 * path. `getUnit` in features/programs/queries.ts contains a byte-identical
 * copy of this mapping block but is not covered here: it builds its
 * Supabase client via `next/headers` `cookies()` (lib/supabase/server.ts),
 * which throws "called outside a request scope" when invoked outside real
 * Next.js request handling — confirmed empirically, not assumed. There is
 * no supported way to fake that request scope from plain Vitest, so
 * getUnit's OWN query construction (RLS-scoped session client, different
 * .eq() filters) stays unexercised by an automated test; only its shared
 * mapping logic is covered, by proxy, through this describe block.
 */
describe("getParticipantUnitDetail: photo evidence mapping", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let programId: string;
  let unitId: string;
  let unitStageId: string;
  let photoAReqId: string;
  let photoBReqId: string;
  let textReqId: string;
  let uploaderParticipantId: string;
  let scope: TokenScope;
  let orphanEvidenceId: string;

  async function insertEvidence(fields: {
    responseId: string | null;
    path: string;
    filename: string;
    sizeBytes: number;
    createdAt: string;
    uploadedByParticipantId?: string | null;
  }): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into public.evidence
        (org_id, unit_id, unit_stage_id, response_id, path, filename, mime, size_bytes, checksum_sha256, uploaded_by_participant_id, created_at)
      values
        (${orgId}, ${unitId}, ${unitStageId}, ${fields.responseId},
         ${fields.path}, ${fields.filename}, 'image/jpeg', ${fields.sizeBytes},
         ${"a".repeat(64)}, ${fields.uploadedByParticipantId ?? null}, ${fields.createdAt})
      returning id
    `;
    return row.id;
  }

  beforeAll(async () => {
    alice = await signedInUser("photomap");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "PhotoMapOrg" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "PhotoMap Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Evidence", position: 0 })
      .select("id")
      .single();
    const { error: reqError } = await alice.from("template_stage_requirements").insert([
      { template_stage_id: s!.id, org_id: orgId, type: "photo", label: "Photo A", required: false, config: {}, position: 0 },
      { template_stage_id: s!.id, org_id: orgId, type: "photo", label: "Photo B", required: false, config: {}, position: 1 },
      { template_stage_id: s!.id, org_id: orgId, type: "text", label: "Notes", required: false, config: {}, position: 2 },
    ]);
    if (reqError) throw reqError;

    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: t!.id,
      p_name: "PhotoMap Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    const { data: pStages } = await alice
      .from("program_stages")
      .select("id")
      .eq("program_id", programId);
    const stageId = pStages![0].id;

    const { data: reqs } = await alice
      .from("program_stage_requirements")
      .select("id, label")
      .eq("program_id", programId);
    photoAReqId = reqs!.find((r) => r.label === "Photo A")!.id;
    photoBReqId = reqs!.find((r) => r.label === "Photo B")!.id;
    textReqId = reqs!.find((r) => r.label === "Notes")!.id;

    const { data: parts, error: e3 } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "Map Participant" },
        { org_id: orgId, name: "Map Uploader" },
      ])
      .select("id, name");
    if (e3) throw e3;
    const participantId = parts!.find((p) => p.name === "Map Participant")!.id;
    uploaderParticipantId = parts!.find((p) => p.name === "Map Uploader")!.id;

    const { data: unit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "PhotoMap Unit", assigned_participant_id: participantId })
      .select("id")
      .single();
    unitId = unit!.id;
    const { data: unitStages } = await alice
      .from("unit_stages")
      .select("id, program_stage_id")
      .eq("unit_id", unitId);
    unitStageId = unitStages!.find((us) => us.program_stage_id === stageId)!.id;

    const tok = generateParticipantToken();
    const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { data: me } = await alice.auth.getUser();
    const { error: mintError } = await alice.from("access_tokens").insert({
      org_id: orgId,
      token_hash: tok.tokenHash,
      kind: "participant",
      participant_id: participantId,
      program_id: programId,
      expires_at: in30d,
      created_by: me!.user!.id,
    });
    if (mintError) throw mintError;
    const resolved = await resolveParticipantToken(tok.token, "photomap-test");
    if (resolved.status !== "ok") throw new Error(`token did not resolve: ${resolved.status}`);
    scope = resolved.scope;

    // Response anchors the way record_photo_evidence creates them: an
    // all-null response row per photo requirement (see the SQL comment in
    // requirements.integration.test.ts for why this goes straight to
    // Postgres). Photo A gets three evidence rows, deliberately inserted
    // OUT of created_at order, so a passing ordering assertion can only be
    // explained by the read model's own explicit sort — not by incidental
    // table scan order.
    const [{ id: respA }] = await sql<{ id: string }[]>`
      insert into public.unit_stage_responses (unit_stage_id, program_stage_requirement_id)
      values (${unitStageId}, ${photoAReqId}) returning id
    `;
    const [{ id: respB }] = await sql<{ id: string }[]>`
      insert into public.unit_stage_responses (unit_stage_id, program_stage_requirement_id)
      values (${unitStageId}, ${photoBReqId}) returning id
    `;

    const t0 = "2026-01-01T00:00:00.000Z"; // chronologically FIRST
    const t1 = "2026-01-01T00:00:01.000Z"; // chronologically MIDDLE
    const t2 = "2026-01-01T00:00:02.000Z"; // chronologically LAST
    // Insertion order: middle, last, first — the reverse of created_at
    // order for the first two, so a naive "return rows as the DB gave them"
    // implementation would very likely fail the ordering test below.
    await insertEvidence({
      responseId: respA,
      path: `${orgId}/${programId}/${unitId}/middle.jpg`,
      filename: "middle.jpg",
      sizeBytes: 222,
      createdAt: t1,
      uploadedByParticipantId: uploaderParticipantId,
    });
    await insertEvidence({
      responseId: respA,
      path: `${orgId}/${programId}/${unitId}/last.jpg`,
      filename: "last.jpg",
      sizeBytes: 333,
      createdAt: t2,
    });
    await insertEvidence({
      responseId: respA,
      path: `${orgId}/${programId}/${unitId}/first.jpg`,
      filename: "first.jpg",
      sizeBytes: 111,
      createdAt: t0,
    });
    // Photo B: exactly one evidence row — the bucketing proof (Photo A's
    // three rows must never leak in here, and vice versa).
    await insertEvidence({
      responseId: respB,
      path: `${orgId}/${programId}/${unitId}/b.jpg`,
      filename: "b.jpg",
      sizeBytes: 444,
      createdAt: "2026-01-01T00:00:03.000Z",
    });
    // Orphaned evidence: response_id is NULL (the row survived a response
    // deletion — see the evidence table's own comment). unit_stage_id is
    // still required (NOT NULL), but there is no requirement to bucket
    // this under; it must be excluded from every requirement's photos.
    orphanEvidenceId = await insertEvidence({
      responseId: null,
      path: `${orgId}/${programId}/${unitId}/orphan.jpg`,
      filename: "orphan.jpg",
      sizeBytes: 555,
      createdAt: "2026-01-01T00:00:04.000Z",
    });
  });

  afterAll(async () => {
    await sql.end();
  });

  it("buckets photos under their own requirement, excludes orphaned evidence from every requirement, and leaves non-photo requirements empty", async () => {
    const detail = await getParticipantUnitDetail(scope, unitId);
    expect(detail).not.toBeNull();
    const reqs = detail!.stages[0].requirements;
    const photoA = reqs.find((r) => r.id === photoAReqId)!;
    const photoB = reqs.find((r) => r.id === photoBReqId)!;
    const notes = reqs.find((r) => r.id === textReqId)!;

    // Would fail if bucketing merged both photo requirements' evidence, or
    // dropped rows: exactly 3 and 1, no more, no less.
    expect(photoA.photos).toHaveLength(3);
    expect(photoB.photos).toHaveLength(1);
    expect(photoB.photos[0].filename).toBe("b.jpg");
    // Would fail if the orphan-skip guard (`if (!reqId) continue`) were
    // removed and the orphan fell into some bucket by accident.
    const allPhotoIds = [...photoA.photos, ...photoB.photos].map((p) => p.id);
    expect(allPhotoIds).not.toContain(orphanEvidenceId);
    // Would fail if `photos: photosByReq.get(r.id) ?? []` were changed to
    // e.g. attach every unit's evidence to every requirement.
    expect(notes.photos).toEqual([]);
  });

  it("orders a requirement's photos by created_at ascending, independent of insertion order", async () => {
    const detail = await getParticipantUnitDetail(scope, unitId);
    const photoA = detail!.stages[0].requirements.find((r) => r.id === photoAReqId)!;
    // Insertion order was middle, last, first — this can only read
    // first/middle/last if the read model's explicit
    // `.sort((a, b) => a.created_at.localeCompare(...) || a.id...)` runs.
    expect(photoA.photos.map((p) => p.filename)).toEqual(["first.jpg", "middle.jpg", "last.jpg"]);
    expect(photoA.photos.map((p) => p.sizeBytes)).toEqual([111, 222, 333]);
  });

  it("resolves the uploader's participant name from uploaded_by_participant_id, and reports null when unattributed", async () => {
    const detail = await getParticipantUnitDetail(scope, unitId);
    const photoA = detail!.stages[0].requirements.find((r) => r.id === photoAReqId)!;
    const middle = photoA.photos.find((p) => p.filename === "middle.jpg")!;
    const first = photoA.photos.find((p) => p.filename === "first.jpg")!;
    // Would fail if the participants(name) embed were dropped, mis-joined
    // (e.g. against the answering participant instead of the uploader), or
    // if uploadedBy defaulted to the id instead of the name.
    expect(middle.uploadedBy).toBe("Map Uploader");
    // Would fail if a missing attribution defaulted to "" or the row's own
    // id instead of null.
    expect(first.uploadedBy).toBeNull();
  });

  it("degrades a photo's url to null — without dropping the photo — when the stored object doesn't exist", async () => {
    // None of the evidence rows above were ever uploaded to the storage
    // bucket (only their metadata rows exist), so signEvidencePaths (in
    // lib/storage/evidence.ts) cannot find a real object at any of these
    // paths and simply omits them from its returned Map — confirmed
    // empirically against the local stack (no per-path entry, no thrown
    // error). This test proves the READ MODEL survives that gap
    // (`url: signed.get(e.path) ?? null`) by degrading to a filename tile
    // rather than dropping the photo or throwing.
    const detail = await getParticipantUnitDetail(scope, unitId);
    const photoB = detail!.stages[0].requirements.find((r) => r.id === photoBReqId)!;
    expect(photoB.photos).toHaveLength(1); // still present...
    expect(photoB.photos[0].url).toBeNull(); // ...just with no signed url
    expect(photoB.photos[0].filename).toBe("b.jpg"); // other fields intact
  });
});
