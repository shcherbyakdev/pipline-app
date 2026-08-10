/**
 * Reader scope (slice 7, final review I3). The readers in @/lib/tokens run on
 * the SERVICE-ROLE client and therefore bypass RLS completely — their
 * org/program/assignment/unit-pin filters are the *only* thing separating one
 * participant from another's data. The SQL suite proves the write path; this
 * proves the read path, against real minted tokens resolved through the real
 * RPC (no hand-built scope objects, which would test nothing).
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
