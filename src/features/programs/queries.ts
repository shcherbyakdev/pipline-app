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

export type ProgramStage = { id: string; name: string; position: number };
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

export async function getProgram(id: string): Promise<ProgramDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select(
      "id, name, created_at, templates(name), program_stages(id, name, position), units(id, name, external_ref, created_at, unit_stages(id, program_stage_id, status))",
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
    program_stages: { id: string; name: string; position: number }[];
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
    .map((s) => ({ id: s.id, name: s.name, position: s.position }));
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
