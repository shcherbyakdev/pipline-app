import { createClient } from "@/lib/supabase/server";

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

export type SectionRequirement = {
  id: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "photo";
  label: string;
  required: boolean;
  config: { options?: string[]; group?: string };
  // The stored answer, normalized: string (text/choice/date), number, boolean, or null.
  value: string | number | boolean | null;
};

export type StageSection = {
  unitStageId: string;
  programStageId: string;
  name: string;
  position: number;
  status: "pending" | "done";
  doneSource: "requirements" | "override" | null;
  requirements: SectionRequirement[];
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
      "id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_source)",
    )
    .eq("id", unitId)
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null;

  const [{ data: stages, error: e1 }, { data: reqs, error: e2 }, { data: resps, error: e3 }] =
    await Promise.all([
      supabase.from("program_stages").select("id, name, position").eq("program_id", programId),
      supabase
        .from("program_stage_requirements")
        .select("id, program_stage_id, type, label, required, config, position")
        .eq("program_id", programId),
      supabase
        .from("unit_stage_responses")
        .select("program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId),
    ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;

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
            })),
        }];
      }),
  };
}

export async function getProgram(id: string): Promise<ProgramDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select(
      "id, name, created_at, templates(name), program_stages(id, name, position, program_stage_requirements(count)), units(id, name, external_ref, created_at, unit_stages(id, program_stage_id, status))",
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
          stages: stages.flatMap((s) => {
            const us = byStage.get(s.id);
            return us ? [{ unitStageId: us.id, stageId: s.id, done: us.status === "done" }] : [];
          }),
        };
      }),
  };
}
