import { createClient } from "@/lib/supabase/server";

export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  stageCount: number;
  updatedAt: string;
};

export type Stage = { id: string; name: string; position: number };

export type TemplateDetail = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  stages: Stage[];
};

// RLS scopes every read to the caller's orgs — no explicit org filter needed.
export async function listTemplates(): Promise<TemplateListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, description, updated_at, template_stages(count)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stageCount: t.template_stages[0]?.count ?? 0,
    updatedAt: t.updated_at,
  }));
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, description, updated_at, template_stages(id, name, position)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    updatedAt: data.updated_at,
    stages: [...data.template_stages].sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id),
    ),
  };
}
