import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import type { StageSection } from "@/features/programs/queries";
import { SlidingWindowLimiter } from "./rate-limit";

export { generateParticipantToken, hashToken } from "./mint";

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

// DoS hygiene only — the boundary is token entropy (see lib/tokens/mint.ts),
// never this counter. Sized generously (120/min) because EVERY flow action
// revalidates the page, which re-resolves the token: a participant working
// through a 30-field checklist legitimately burns a slot per save. A tighter
// budget would brick a live session mid-form, and x-forwarded-for is
// client-settable anyway — so this is a noise floor, not a defence.
const limiter = new SlidingWindowLimiter(120, 60_000);

// Both /p pages derive the limiter bucket the same way; keep it in one place
// so the two can never drift. An IP when the proxy sets one, else "server".
export function clientKeyFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "server";
}

// THE chokepoint: the only code that hands a raw token to the database.
// clientKey groups rate-limit hits (an IP, or "server" when unknown).
// Tokens are NEVER logged — not even at error level.
export async function resolveParticipantToken(
  token: string,
  clientKey: string,
): Promise<ResolveResult> {
  // Distinct from not_found: a throttled caller sees "try again in a minute",
  // not a 404 that reads as "your link is dead".
  if (!limiter.allow(`${clientKey}:${token.slice(0, 8)}`)) return { status: "rate_limited" };
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
  const [{ data: stages, error: e1 }, { data: reqs, error: e2 }, { data: resps, error: e3 }] =
    await Promise.all([
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
        .select("program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId)
        .eq("org_id", scope.orgId),
    ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;

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
            })),
        }];
      }),
  };
}

export function buildParticipantUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/p/${token}`;
}
