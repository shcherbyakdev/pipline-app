import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import { signEvidencePaths } from "@/lib/storage/evidence";
import { tokenLimiter } from "./rate-limit";

export type PortalScope = {
  orgId: string;
  orgName: string;
  clientId: string;
  clientName: string;
};

export type ResolvePortalResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "expired" | "revoked"; orgName: string }
  | { status: "ok"; scope: PortalScope };

// The portal side of THE chokepoint (see participant.ts for the twin).
// Tokens are NEVER logged — not even at error level.
export async function resolvePortalToken(
  token: string,
  clientKey: string,
): Promise<ResolvePortalResult> {
  if (!tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)) return { status: "rate_limited" };
  if (token.length < 20 || token.length > 200) return { status: "not_found" };

  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_portal_token", { p_token: token });
  if (error) {
    console.error("[tokens] portal resolve failed:", error.code ?? error.message); // no token in logs
    return { status: "not_found" };
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { status: "not_found" };
  if (row.status === "expired" || row.status === "revoked") {
    return { status: row.status, orgName: row.org_name as string };
  }
  // Fail closed: only an explicit "ok" opens the scope.
  if (row.status !== "ok") return { status: "not_found" };
  return {
    status: "ok",
    scope: {
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      clientId: row.client_id as string,
      clientName: row.client_name as string,
    },
  };
}

export type PortalUnitSummary = {
  id: string;
  name: string;
  externalRef: string | null;
  done: number;
  total: number;
  lastActivity: string | null;
};
export type PortalProgramGroup = {
  programId: string;
  programName: string;
  units: PortalUnitSummary[];
};

// Home read model. Admin client bypasses RLS entirely — EVERY query below
// carries its own explicit org_id, plus client_id or an already-scoped
// unit_id (slice-8 rule: never rely on an earlier check for tenancy).
// Units with client_id null do not exist as far as any portal token is
// concerned.
export async function getPortalUnits(scope: PortalScope): Promise<PortalProgramGroup[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(status, done_at)")
    .eq("org_id", scope.orgId)
    .eq("client_id", scope.clientId);
  if (error) throw error;
  const units = data ?? [];
  if (units.length === 0) return [];

  // Last activity = greatest(max(stage done_at), max(response updated_at)):
  // done_at alone misses in-progress work; updated_at alone misses overrides.
  const { data: resps, error: e2 } = await db
    .from("unit_stage_responses")
    .select("unit_id, updated_at")
    .eq("org_id", scope.orgId)
    .in("unit_id", units.map((u) => u.id));
  if (e2) throw e2;
  const respMax = new Map<string, string>();
  for (const r of resps ?? []) {
    const prev = respMax.get(r.unit_id);
    if (!prev || r.updated_at > prev) respMax.set(r.unit_id, r.updated_at);
  }

  const groups = new Map<string, PortalProgramGroup>();
  for (const u of units) {
    const doneAts = u.unit_stages
      .map((s) => s.done_at)
      .filter((d): d is string => d !== null);
    const candidates = [...doneAts, ...(respMax.has(u.id) ? [respMax.get(u.id)!] : [])];
    const summary: PortalUnitSummary = {
      id: u.id,
      name: u.name,
      externalRef: u.external_ref as string | null,
      done: u.unit_stages.filter((s) => s.status === "done").length,
      total: u.unit_stages.length,
      lastActivity: candidates.length ? candidates.sort().at(-1)! : null,
    };
    const programName = (u.programs as unknown as { name: string } | null)?.name ?? "—";
    const group: PortalProgramGroup = groups.get(u.program_id) ?? {
      programId: u.program_id,
      programName,
      units: [],
    };
    group.units.push(summary);
    groups.set(u.program_id, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, units: g.units.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.programName.localeCompare(b.programName) || a.programId.localeCompare(b.programId));
}

// NO field in these types can carry a person's name — attribution is
// excluded at the TYPE level (spec §portal read model). The queries below
// never join participants or user tables.
export type PortalPhoto = { id: string; filename: string; createdAt: string; url: string | null };
export type PortalItem = {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "photo";
  value: string | number | boolean | null;
  photos: PortalPhoto[];
};
export type PortalStage = {
  id: string;
  name: string;
  position: number;
  status: "pending" | "done";
  doneAt: string | null;
  items: PortalItem[];
};
export type PortalUnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  programName: string;
  stages: PortalStage[];
};

// THE portal rule: a done stage expands (its answered requirements, typed
// values, photo thumbnails); a pending stage is a name plus "awaiting" —
// items stays []. The client never sees the org's internal checklist
// before it is satisfied.
export async function getPortalUnitDetail(
  scope: PortalScope,
  unitId: string,
): Promise<PortalUnitDetail | null> {
  const db = createAdminClient();
  const { data: unit, error } = await db
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_at)")
    .eq("id", unitId)
    .eq("org_id", scope.orgId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null; // cross-client / cross-org reads as nonexistent

  const programId = unit.program_id;
  const [
    { data: stages, error: e1 },
    { data: reqs, error: e2 },
    { data: resps, error: e3 },
    { data: ev, error: e4 },
  ] = await Promise.all([
    db.from("program_stages").select("id, name, position")
      .eq("program_id", programId).eq("org_id", scope.orgId),
    db.from("program_stage_requirements").select("id, program_stage_id, type, label, position")
      .eq("program_id", programId).eq("org_id", scope.orgId),
    db.from("unit_stage_responses")
      .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
      .eq("unit_id", unitId).eq("org_id", scope.orgId),
    // Deliberately NO participants(name) embed — see the type-level rule above.
    db.from("evidence").select("id, response_id, path, filename, created_at")
      .eq("unit_id", unitId).eq("org_id", scope.orgId),
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
  const responseByReq = new Map((resps ?? []).map((r) => [r.program_stage_requirement_id, r]));
  const respIdToReq = new Map((resps ?? []).map((r) => [r.id, r.program_stage_requirement_id]));

  const photoRows = [...(ev ?? [])].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const signed = await signEvidencePaths(photoRows.map((e) => e.path));
  const photosByReq = new Map<string, PortalPhoto[]>();
  for (const e of photoRows) {
    const reqId = e.response_id ? respIdToReq.get(e.response_id) : undefined;
    if (!reqId) continue;
    const list = photosByReq.get(reqId) ?? [];
    list.push({ id: e.id, filename: e.filename, createdAt: e.created_at, url: signed.get(e.path) ?? null });
    photosByReq.set(reqId, list);
  }

  const usByStage = new Map(unit.unit_stages.map((us) => [us.program_stage_id, us]));
  return {
    id: unit.id,
    name: unit.name,
    externalRef: unit.external_ref as string | null,
    programName: (unit.programs as unknown as { name: string } | null)?.name ?? "—",
    stages: [...(stages ?? [])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap((s) => {
        const us = usByStage.get(s.id);
        if (!us) return [];
        const status = us.status as "pending" | "done";
        const items: PortalItem[] =
          status !== "done"
            ? [] // pending stages carry NOTHING — the portal rule
            : (reqs ?? [])
                .filter((r) => r.program_stage_id === s.id)
                .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
                .flatMap((r) => {
                  const resp = responseByReq.get(r.id);
                  const photos = photosByReq.get(r.id) ?? [];
                  // Only ANSWERED requirements render (an optional,
                  // unanswered one has nothing to show).
                  if (!resp && photos.length === 0) return [];
                  return [{
                    id: r.id,
                    label: r.label,
                    type: r.type as PortalItem["type"],
                    value: resp ? valueOf(resp) : null,
                    photos,
                  }];
                });
        return [{
          id: s.id,
          name: s.name,
          position: s.position,
          status,
          doneAt: (us.done_at as string | null) ?? null,
          items,
        }];
      }),
  };
}

export function buildPortalUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/portal/${token}`;
}
