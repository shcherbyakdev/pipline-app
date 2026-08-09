"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createProgramInput,
  renameProgramInput,
  deleteProgramInput,
  addUnitInput,
  renameUnitInput,
  deleteUnitInput,
  setUnitStageStatusInput,
  saveResponseInput,
  clearResponseInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

export type CreateProgramState = { error?: string };

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[programs] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

export async function createProgram(
  _prev: CreateProgramState,
  formData: FormData,
): Promise<CreateProgramState> {
  const parsed = createProgramInput.safeParse({
    templateId: formData.get("templateId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: "Pick a template and a name (1–80 characters)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_program", {
    p_template_id: parsed.data.templateId,
    p_name: parsed.data.name,
  });
  if (error || !data) {
    console.error("[programs] createProgram:", error);
    return { error: GENERIC_WRITE_ERROR };
  }

  revalidatePath("/programs");
  redirect(`/programs/${(data as { id: string }).id}`);
}

export async function renameProgram(input: unknown): Promise<ActionState> {
  const parsed = renameProgramInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("renameProgram", error ?? "program not visible");
  revalidatePath("/programs");
  revalidatePath(`/programs/${parsed.data.id}`);
  return { ok: true };
}

export async function deleteProgram(input: unknown): Promise<ActionState> {
  const parsed = deleteProgramInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("programs").delete().eq("id", parsed.data.id);
  if (error) return fail("deleteProgram", error);
  revalidatePath("/programs");
  redirect("/programs");
}

export async function addUnit(input: unknown): Promise<ActionState> {
  const parsed = addUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as tenancy + org_id source; RLS hides foreign rows.
  const { data: program } = await supabase
    .from("programs")
    .select("id, org_id")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (!program) return fail("addUnit", "program not visible");

  const { error } = await supabase.from("units").insert({
    program_id: program.id,
    org_id: program.org_id,
    name: parsed.data.name,
    external_ref: parsed.data.externalRef || null,
  });
  if (error) return fail("addUnit", error);
  revalidatePath("/programs");
  revalidatePath(`/programs/${program.id}`);
  return { ok: true };
}

export async function renameUnit(input: unknown): Promise<ActionState> {
  const parsed = renameUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("renameUnit", error ?? "unit not visible");
  revalidatePath("/programs");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}

export async function deleteUnit(input: unknown): Promise<ActionState> {
  const parsed = deleteUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .delete()
    .eq("id", parsed.data.id)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("deleteUnit", error ?? "unit not visible");
  revalidatePath("/programs");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}

export async function setUnitStageStatus(input: unknown): Promise<ActionState> {
  const parsed = setUnitStageStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_stages")
    .update({ status: parsed.data.done ? "done" : "pending" })
    .eq("id", parsed.data.id)
    .select("program_id, unit_id")
    .maybeSingle();
  if (error || !data) return fail("setUnitStageStatus", error ?? "unit stage not visible");
  revalidatePath("/programs");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
  return { ok: true };
}

export async function saveResponse(input: unknown): Promise<ActionState> {
  const parsed = saveResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const values = {
    value_text: d.type === "text" || d.type === "choice" ? d.value : null,
    value_number: d.type === "number" ? d.value : null,
    value_bool: d.type === "boolean" ? d.value : null,
    value_date: d.type === "date" ? d.value : null,
  };
  const supabase = await createClient();
  // The trust trigger derives org/unit/program/type and validates the pair;
  // the conflict target is the (unit_stage, requirement) uniqueness.
  const { data, error } = await supabase
    .from("unit_stage_responses")
    .upsert(
      {
        unit_stage_id: d.unitStageId,
        program_stage_requirement_id: d.requirementId,
        ...values,
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    )
    .select("program_id, unit_id")
    .maybeSingle();
  if (error || !data) return fail("saveResponse", error ?? "response not visible");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
  return { ok: true };
}

export async function clearResponse(input: unknown): Promise<ActionState> {
  const parsed = clearResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_stage_responses")
    .delete()
    .eq("unit_stage_id", parsed.data.unitStageId)
    .eq("program_stage_requirement_id", parsed.data.requirementId)
    .select("program_id, unit_id")
    .maybeSingle();
  if (error) return fail("clearResponse", error);
  // Deleting an absent response is a no-op success (idempotent clear).
  if (data) {
    revalidatePath(`/programs/${data.program_id}`);
    revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
  }
  return { ok: true };
}
