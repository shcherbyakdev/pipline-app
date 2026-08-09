import { createClient } from "@/lib/supabase/server";

export type RolloutListItem = {
  id: string;
  name: string;
  templateName: string | null;
  stageCount: number;
  unitCount: number;
  createdAt: string;
};

export type RolloutStage = { id: string; name: string; position: number };
export type Unit = { id: string; name: string; externalRef: string | null };

export type RolloutDetail = {
  id: string;
  name: string;
  templateName: string | null;
  createdAt: string;
  stages: RolloutStage[];
  units: Unit[];
};

// RLS scopes every read to the caller's orgs.
export async function listRollouts(): Promise<RolloutListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rollouts")
    .select("id, name, created_at, templates(name), rollout_stages(count), units(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  type RolloutRow = {
    id: string;
    name: string;
    created_at: string;
    templates: { name: string } | null;
    rollout_stages: { count: number }[];
    units: { count: number }[];
  };
  return ((data ?? []) as unknown as RolloutRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    templateName: r.templates?.name ?? null,
    stageCount: r.rollout_stages[0]?.count ?? 0,
    unitCount: r.units[0]?.count ?? 0,
    createdAt: r.created_at,
  }));
}

export async function getRollout(id: string): Promise<RolloutDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rollouts")
    .select(
      "id, name, created_at, templates(name), rollout_stages(id, name, position), units(id, name, external_ref, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  type RolloutDetailRow = {
    id: string;
    name: string;
    created_at: string;
    templates: { name: string } | null;
    rollout_stages: { id: string; name: string; position: number }[];
    units: { id: string; name: string; external_ref: string | null; created_at: string }[];
  };
  const row = data as unknown as RolloutDetailRow;
  return {
    id: row.id,
    name: row.name,
    templateName: row.templates?.name ?? null,
    createdAt: row.created_at,
    stages: [...row.rollout_stages]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((s) => ({ id: s.id, name: s.name, position: s.position })),
    units: [...row.units]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((u) => ({ id: u.id, name: u.name, externalRef: u.external_ref })),
  };
}
