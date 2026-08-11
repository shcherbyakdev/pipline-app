import { createClient } from "@/lib/supabase/server";
import { signEvidencePaths } from "@/lib/storage/evidence";

export type ProgramListItem = {
  id: string;
  name: string;
  templateName: string | null;
  stageCount: number;
  unitCount: number;
  doneCount: number;
  totalCount: number;
  createdAt: string;
};

export type ProgramStage = { id: string; name: string; position: number; hasRequirements: boolean };
export type UnitStageCell = { unitStageId: string; stageId: string; done: boolean };
export type Unit = {
  id: string;
  name: string;
  externalRef: string | null;
  assignedParticipantId: string | null;
  clientId: string | null;
  stages: UnitStageCell[];
};

export type ProgramDetail = {
  id: string;
  name: string;
  templateName: string | null;
  createdAt: string;
  stages: ProgramStage[];
  units: Unit[];
};

// RLS scopes every read to the caller's orgs.
export async function listPrograms(): Promise<ProgramListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select(
      "id, name, created_at, templates(name), program_stages(count), units(count), done:unit_stages(count)",
    )
    .eq("done.status", "done")
    .order("created_at", { ascending: false });
  if (error) throw error;
  type ProgramRow = {
    id: string;
    name: string;
    created_at: string;
    templates: { name: string } | null;
    program_stages: { count: number }[];
    units: { count: number }[];
    done: { count: number }[];
  };
  return ((data ?? []) as unknown as ProgramRow[]).map((r) => {
    const stageCount = r.program_stages[0]?.count ?? 0;
    const unitCount = r.units[0]?.count ?? 0;
    return {
      id: r.id,
      name: r.name,
      templateName: r.templates?.name ?? null,
      stageCount,
      unitCount,
      doneCount: r.done[0]?.count ?? 0,
      // Fan-out invariant: every unit has exactly one row per stage.
      totalCount: stageCount * unitCount,
      createdAt: r.created_at,
    };
  });
}

export type EvidencePhoto = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string | null; // participant name, when known
  url: string | null; // short-lived signed URL; null → filename tile
  // Client-only optimistic placeholder marker (never set by a read model —
  // both readers below only ever build real rows). Distinct from `url ===
  // null`, which also happens for a genuinely stored photo whose signing
  // failed; that photo must stay removable, so removal is gated on this
  // flag, not on `url`.
  optimistic?: true;
};

export type SectionRequirement = {
  id: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "photo";
  label: string;
  required: boolean;
  config: { options?: string[]; group?: string };
  // The stored answer, normalized: string (text/choice/date), number, boolean, or null.
  value: string | number | boolean | null;
  // Photo requirements only; [] for scalar types.
  photos: EvidencePhoto[];
  recurLeadDays: number | null;
};

export type PreviousRound = {
  supersededAt: string;
  items: { label: string; value: string }[];
};

export type StageSection = {
  unitStageId: string;
  programStageId: string;
  name: string;
  position: number;
  status: "pending" | "done";
  doneSource: "requirements" | "override" | null;
  requirements: SectionRequirement[];
  dueAt: string | null;
  previousRounds: PreviousRound[];
};

export type UnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  programId: string;
  programName: string;
  stages: StageSection[];
};

export async function getUnit(programId: string, unitId: string): Promise<UnitDetail | null> {
  const supabase = await createClient();
  const { data: unit, error } = await supabase
    .from("units")
    .select(
      "id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_source, due_at)",
    )
    .eq("id", unitId)
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null;

  const [
    { data: stages, error: e1 },
    { data: reqs, error: e2 },
    { data: resps, error: e3 },
    { data: ev, error: e4 },
    { data: archived, error: e5 },
  ] = await Promise.all([
    supabase.from("program_stages").select("id, name, position").eq("program_id", programId),
    supabase
      .from("program_stage_requirements")
      .select("id, program_stage_id, type, label, required, config, position, recur_lead_days")
      .eq("program_id", programId),
    supabase
      .from("unit_stage_responses")
      .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
      .eq("unit_id", unitId),
    supabase
      .from("evidence")
      .select("id, response_id, path, filename, size_bytes, created_at, participants(name)")
      .eq("unit_id", unitId),
    supabase
      .from("unit_stage_response_archive")
      .select("unit_stage_id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date, superseded_at")
      .eq("unit_id", unitId),
  ]);
  if (e1 || e2 || e3 || e4 || e5) throw e1 ?? e2 ?? e3 ?? e4 ?? e5;

  type RespRow = NonNullable<typeof resps>[number];
  // PostgREST serializes numeric as a string — normalize here, once.
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

  type ArchiveRow = NonNullable<typeof archived>[number];
  const displayValue = (r: ArchiveRow): string =>
    r.type === "boolean"
      ? r.value_bool ? "Yes" : "No"
      : r.type === "number"
        ? String(r.value_number ?? "—")
        : r.type === "photo"
          ? "photo"
          : String(r.value_date ?? r.value_text ?? "—");
  const reqLabel = new Map((reqs ?? []).map((r) => [r.id, r.label]));
  // stage → superseded_at → items. Rounds render newest first.
  const roundsByStage = new Map<string, Map<string, { label: string; value: string }[]>>();
  for (const a of archived ?? []) {
    const rounds = roundsByStage.get(a.unit_stage_id) ?? new Map();
    const items = rounds.get(a.superseded_at) ?? [];
    items.push({ label: reqLabel.get(a.program_stage_requirement_id) ?? "—", value: displayValue(a) });
    rounds.set(a.superseded_at, items);
    roundsByStage.set(a.unit_stage_id, rounds);
  }

  // RLS proved org scope; signing is display-only.
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
    externalRef: unit.external_ref,
    programId: unit.program_id,
    programName: (unit.programs as unknown as { name: string } | null)?.name ?? "Program",
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
              type: r.type as SectionRequirement["type"],
              label: r.label,
              required: r.required,
              config: (r.config ?? {}) as SectionRequirement["config"],
              value: responseByReq.get(r.id) ?? null,
              photos: photosByReq.get(r.id) ?? [],
              recurLeadDays: r.recur_lead_days,
            })),
          dueAt: (us as { due_at?: string | null }).due_at ?? null,
          previousRounds: [...(roundsByStage.get(us.id) ?? new Map())]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([supersededAt, items]) => ({ supersededAt, items })),
        }];
      }),
  };
}

export async function getProgram(id: string): Promise<ProgramDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select(
      "id, name, created_at, templates(name), program_stages(id, name, position, program_stage_requirements(count)), units(id, name, external_ref, assigned_participant_id, client_id, created_at, unit_stages(id, program_stage_id, status))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  type ProgramDetailRow = {
    id: string;
    name: string;
    created_at: string;
    templates: { name: string } | null;
    program_stages: {
      id: string;
      name: string;
      position: number;
      program_stage_requirements: { count: number }[];
    }[];
    units: {
      id: string;
      name: string;
      external_ref: string | null;
      assigned_participant_id: string | null;
      client_id: string | null;
      created_at: string;
      unit_stages: { id: string; program_stage_id: string; status: string }[];
    }[];
  };
  const row = data as unknown as ProgramDetailRow;
  const stages = [...row.program_stages]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      hasRequirements: (s.program_stage_requirements[0]?.count ?? 0) > 0,
    }));
  return {
    id: row.id,
    name: row.name,
    templateName: row.templates?.name ?? null,
    createdAt: row.created_at,
    stages,
    units: [...row.units]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((u) => {
        // Cell order comes from the already-sorted stages array, never from
        // the embed.
        const byStage = new Map(u.unit_stages.map((us) => [us.program_stage_id, us]));
        return {
          id: u.id,
          name: u.name,
          externalRef: u.external_ref,
          assignedParticipantId: u.assigned_participant_id,
          clientId: u.client_id,
          stages: stages.flatMap((s) => {
            const us = byStage.get(s.id);
            return us ? [{ unitStageId: us.id, stageId: s.id, done: us.status === "done" }] : [];
          }),
        };
      }),
  };
}
