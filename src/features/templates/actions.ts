"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createTemplateInput,
  renameTemplateInput,
  deleteTemplateInput,
  addStageInput,
  renameStageInput,
  deleteStageInput,
  reorderStagesInput,
  addRequirementInput,
  renameRequirementInput,
  deleteRequirementInput,
  reorderRequirementsInput,
  GENERIC_WRITE_ERROR,
  type TemplateActionState,
} from "./schema";

export type CreateTemplateState = { error?: string };

// Error discipline: the client sees GENERIC_WRITE_ERROR; the raw failure is
// logged server-side only. Never return error.message to the client.
function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[templates] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createTemplate(
  _prev: CreateTemplateState,
  formData: FormData,
): Promise<CreateTemplateState> {
  const parsed = createTemplateInput.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: "Name must be 1–80 characters." };

  const orgId = await currentOrgId();
  if (!orgId) redirect("/onboarding");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[templates] createTemplate:", error);
    return { error: GENERIC_WRITE_ERROR };
  }

  revalidatePath("/templates");
  redirect(`/templates/${data.id}`);
}

export async function renameTemplate(input: unknown): Promise<TemplateActionState> {
  const parsed = renameTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("templates")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return fail("renameTemplate", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${parsed.data.id}`);
  return { ok: true };
}

export async function deleteTemplate(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("templates").delete().eq("id", parsed.data.id);
  if (error) return fail("deleteTemplate", error);
  revalidatePath("/templates");
  redirect("/templates");
}

export async function addStage(input: unknown): Promise<TemplateActionState> {
  const parsed = addStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as the tenancy/org_id source; RLS hides foreign rows.
  const { data: template } = await supabase
    .from("templates")
    .select("id, org_id, template_stages(position)")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return fail("addStage", "template not visible");

  const nextPosition =
    template.template_stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { error } = await supabase.from("template_stages").insert({
    template_id: template.id,
    org_id: template.org_id,
    name: parsed.data.name,
    position: nextPosition,
  });
  if (error) return fail("addStage", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${template.id}`);
  return { ok: true };
}

export async function renameStage(input: unknown): Promise<TemplateActionState> {
  const parsed = renameStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_stages")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("template_id")
    .maybeSingle();
  if (error || !data) return fail("renameStage", error ?? "stage not visible");
  revalidatePath("/templates");
  revalidatePath(`/templates/${data.template_id}`);
  return { ok: true };
}

export async function deleteStage(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Plain delete — position gaps are harmless under ORDER BY position, id.
  const { data, error } = await supabase
    .from("template_stages")
    .delete()
    .eq("id", parsed.data.id)
    .select("template_id")
    .maybeSingle();
  if (error || !data) return fail("deleteStage", error ?? "stage not visible");
  revalidatePath("/templates");
  revalidatePath(`/templates/${data.template_id}`);
  return { ok: true };
}

export async function reorderStages(input: unknown): Promise<TemplateActionState> {
  const parsed = reorderStagesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_stages", {
    p_template_id: parsed.data.templateId,
    p_stage_ids: parsed.data.stageIds,
  });
  if (error) return fail("reorderStages", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${parsed.data.templateId}`);
  return { ok: true };
}

export async function addRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = addRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as the tenancy/org_id source; RLS hides foreign rows.
  const { data: stage } = await supabase
    .from("template_stages")
    .select("id, org_id, template_id, template_stage_requirements(position)")
    .eq("id", parsed.data.templateStageId)
    .maybeSingle();
  if (!stage) return fail("addRequirement", "stage not visible");

  const nextPosition =
    stage.template_stage_requirements.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const config =
    parsed.data.type === "choice"
      ? { options: parsed.data.options }
      : parsed.data.type === "checklist"
        ? { items: parsed.data.items }
        : {};

  const { error } = await supabase.from("template_stage_requirements").insert({
    template_stage_id: stage.id,
    org_id: stage.org_id,
    type: parsed.data.type,
    label: parsed.data.label,
    required: parsed.data.required,
    config,
    position: nextPosition,
    recur_lead_days: parsed.data.recurLeadDays ?? null,
  });
  if (error) return fail("addRequirement", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${stage.template_id}`);
  return { ok: true };
}

export async function renameRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = renameRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_stage_requirements")
    .update({ label: parsed.data.label })
    .eq("id", parsed.data.id)
    .select("template_stage_id, template_stages(template_id)")
    .maybeSingle();
  if (error || !data) return fail("renameRequirement", error ?? "requirement not visible");
  revalidatePath("/templates");
  revalidatePath(
    `/templates/${(data.template_stages as unknown as { template_id: string }).template_id}`,
  );
  return { ok: true };
}

export async function deleteRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Plain delete — position gaps are harmless under ORDER BY position, id.
  const { data, error } = await supabase
    .from("template_stage_requirements")
    .delete()
    .eq("id", parsed.data.id)
    .select("template_stage_id, template_stages(template_id)")
    .maybeSingle();
  if (error || !data) return fail("deleteRequirement", error ?? "requirement not visible");
  revalidatePath("/templates");
  revalidatePath(
    `/templates/${(data.template_stages as unknown as { template_id: string }).template_id}`,
  );
  return { ok: true };
}

export async function reorderRequirements(input: unknown): Promise<TemplateActionState> {
  const parsed = reorderRequirementsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_stage_requirements", {
    p_template_stage_id: parsed.data.templateStageId,
    p_requirement_ids: parsed.data.requirementIds,
  });
  if (error) return fail("reorderRequirements", error);
  const { data: stage } = await supabase
    .from("template_stages")
    .select("template_id")
    .eq("id", parsed.data.templateStageId)
    .maybeSingle();
  revalidatePath("/templates");
  if (stage) revalidatePath(`/templates/${stage.template_id}`);
  return { ok: true };
}
