import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import type { EvidencePhoto, StageSection } from "@/features/programs/queries";
import { signEvidencePaths } from "@/lib/storage/evidence";
import { tokenLimiter } from "./rate-limit";

export type TokenScope = {
  orgId: string;
  orgName: string;
  participantId: string;
  participantName: string;
  programId: string;
  programName: string;
  unitId: string | null;
};

export type ResolveResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "expired" | "revoked"; orgName: string }
  | { status: "ok"; scope: TokenScope };

// THE chokepoint: the only code that hands a raw token to the database.
// clientKey groups rate-limit hits (an IP, or "server" when unknown).
// Tokens are NEVER logged — not even at error level.
export async function resolveParticipantToken(
  token: string,
  clientKey: string,
): Promise<ResolveResult> {
  // Distinct from not_found: a throttled caller sees "try again in a minute",
  // not a 404 that reads as "your link is dead".
  if (!tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)) return { status: "rate_limited" };
  if (token.length < 20 || token.length > 200) return { status: "not_found" };

  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_participant_token", { p_token: token });
  if (error) {
    console.error("[tokens] resolve failed:", error.code ?? error.message); // no token in logs
    return { status: "not_found" };
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { status: "not_found" };
  if (row.status === "expired" || row.status === "revoked") {
    return { status: row.status, orgName: row.org_name as string };
  }
  // Fail closed: only an explicit "ok" opens the scope. A future status the
  // SQL grows (or a malformed row) reads as nonexistent rather than valid.
  if (row.status !== "ok") return { status: "not_found" };
  return {
    status: "ok",
    scope: {
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      participantId: row.participant_id as string,
      participantName: row.participant_name as string,
      programId: row.program_id as string,
      programName: row.program_name as string,
      unitId: (row.unit_id as string | null) ?? null,
    },
  };
}

// Scoped READS run on the admin client; every query filters by the resolved
// scope — org, program, live assignment, and the token's unit pin.
function unitFilter(scope: TokenScope) {
  return { programId: scope.programId, participantId: scope.participantId, unitId: scope.unitId };
}

export async function getParticipantUnits(scope: TokenScope) {
  const db = createAdminClient();
  const f = unitFilter(scope);
  let q = db
    .from("units")
    .select("id, name, external_ref, created_at, unit_stages(id, status)")
    .eq("program_id", f.programId)
    .eq("org_id", scope.orgId)
    .eq("assigned_participant_id", f.participantId);
  if (f.unitId) q = q.eq("id", f.unitId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((u) => ({
      id: u.id,
      name: u.name,
      externalRef: u.external_ref as string | null,
      outstanding: u.unit_stages.filter((s) => s.status !== "done").length,
      total: u.unit_stages.length,
    }));
}

export type ParticipantUnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  stages: StageSection[];
};

export async function getParticipantUnitDetail(
  scope: TokenScope,
  unitId: string,
): Promise<ParticipantUnitDetail | null> {
  const db = createAdminClient();
  const f = unitFilter(scope);
  if (f.unitId && f.unitId !== unitId) return null; // unit-pinned token
  const { data: unit, error } = await db
    .from("units")
    .select("id, name, external_ref, unit_stages(id, program_stage_id, status, done_source)")
    .eq("id", unitId)
    .eq("program_id", f.programId)
    .eq("org_id", scope.orgId)
    .eq("assigned_participant_id", f.participantId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null;

  // Every service-role query carries its own org filter — never rely on the early-return above for tenancy.
  const [
    { data: stages, error: e1 },
    { data: reqs, error: e2 },
    { data: resps, error: e3 },
    { data: ev, error: e4 },
  ] = await Promise.all([
    db
      .from("program_stages")
      .select("id, name, position")
      .eq("program_id", f.programId)
      .eq("org_id", scope.orgId),
    db
      .from("program_stage_requirements")
      .select("id, program_stage_id, type, label, required, config, position")
      .eq("program_id", f.programId)
      .eq("org_id", scope.orgId),
    db
      .from("unit_stage_responses")
      .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
      .eq("unit_id", unitId)
      .eq("org_id", scope.orgId),
    // Service-role read → carries its own org filter, per the comment above.
    db
      .from("evidence")
      .select("id, response_id, path, filename, size_bytes, created_at, participants(name)")
      .eq("unit_id", unitId)
      .eq("org_id", scope.orgId),
  ]);
  if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;

  type RespRow = NonNullable<typeof resps>[number];
  const valueOf = (r: RespRow): string | number | boolean | null =>
    r.type === "number"
      ? r.value_number === null ? null : Number(r.value_number)
      : r.type === "boolean"
        ? r.value_bool
        : r.type === "date"
          ? r.value_date
          : r.value_text;
  const responseByReq = new Map((resps ?? []).map((r) => [r.program_stage_requirement_id, valueOf(r)]));
  const usByStage = new Map(unit.unit_stages.map((us) => [us.program_stage_id, us]));

  // Admin client bypasses RLS entirely — the explicit .eq("org_id", ...) on
  // the evidence query above is what scopes this, not RLS. Signing is
  // display-only.
  const respIdToReq = new Map((resps ?? []).map((r) => [r.id, r.program_stage_requirement_id]));
  const photoRows = [...(ev ?? [])].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const signed = await signEvidencePaths(photoRows.map((e) => e.path));
  const photosByReq = new Map<string, EvidencePhoto[]>();
  for (const e of photoRows) {
    const reqId = e.response_id ? respIdToReq.get(e.response_id) : undefined;
    if (!reqId) continue; // detached evidence: kept in the table, not shown per-requirement
    const list = photosByReq.get(reqId) ?? [];
    list.push({
      id: e.id,
      filename: e.filename,
      sizeBytes: e.size_bytes,
      createdAt: e.created_at,
      uploadedBy: (e.participants as unknown as { name: string } | null)?.name ?? null,
      url: signed.get(e.path) ?? null,
    });
    photosByReq.set(reqId, list);
  }

  return {
    id: unit.id,
    name: unit.name,
    externalRef: unit.external_ref as string | null,
    stages: [...(stages ?? [])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap((s) => {
        const us = usByStage.get(s.id);
        if (!us) return [];
        return [{
          unitStageId: us.id,
          programStageId: s.id,
          name: s.name,
          position: s.position,
          status: us.status as "pending" | "done",
          doneSource: us.done_source as StageSection["doneSource"],
          requirements: (reqs ?? [])
            .filter((r) => r.program_stage_id === s.id)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((r) => ({
              id: r.id,
              type: r.type as StageSection["requirements"][number]["type"],
              label: r.label,
              required: r.required,
              config: (r.config ?? {}) as StageSection["requirements"][number]["config"],
              value: responseByReq.get(r.id) ?? null,
              photos: photosByReq.get(r.id) ?? [],
              recurLeadDays: null, // portal due/lapsed surfacing lands in a later task
            })),
          dueAt: null, // portal due/lapsed surfacing lands in a later task
          previousRounds: [],
        }];
      }),
  };
}

export function buildParticipantUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/p/${token}`;
}
