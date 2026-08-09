"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createRolloutInput,
  renameRolloutInput,
  deleteRolloutInput,
  addUnitInput,
  renameUnitInput,
  deleteUnitInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

export type CreateRolloutState = { error?: string };

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[rollouts] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

export async function createRollout(
  _prev: CreateRolloutState,
  formData: FormData,
): Promise<CreateRolloutState> {
  const parsed = createRolloutInput.safeParse({
    templateId: formData.get("templateId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: "Pick a template and a name (1–80 characters)." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rollout", {
    p_template_id: parsed.data.templateId,
    p_name: parsed.data.name,
  });
  if (error || !data) {
    console.error("[rollouts] createRollout:", error);
    return { error: GENERIC_WRITE_ERROR };
  }

  revalidatePath("/rollouts");
  redirect(`/rollouts/${(data as { id: string }).id}`);
}

export async function renameRollout(input: unknown): Promise<ActionState> {
  const parsed = renameRolloutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rollouts")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("renameRollout", error ?? "rollout not visible");
  revalidatePath("/rollouts");
  revalidatePath(`/rollouts/${parsed.data.id}`);
  return { ok: true };
}

export async function deleteRollout(input: unknown): Promise<ActionState> {
  const parsed = deleteRolloutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("rollouts").delete().eq("id", parsed.data.id);
  if (error) return fail("deleteRollout", error);
  revalidatePath("/rollouts");
  redirect("/rollouts");
}

export async function addUnit(input: unknown): Promise<ActionState> {
  const parsed = addUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as tenancy + org_id source; RLS hides foreign rows.
  const { data: rollout } = await supabase
    .from("rollouts")
    .select("id, org_id")
    .eq("id", parsed.data.rolloutId)
    .maybeSingle();
  if (!rollout) return fail("addUnit", "rollout not visible");

  const { error } = await supabase.from("units").insert({
    rollout_id: rollout.id,
    org_id: rollout.org_id,
    name: parsed.data.name,
    external_ref: parsed.data.externalRef || null,
  });
  if (error) return fail("addUnit", error);
  revalidatePath("/rollouts");
  revalidatePath(`/rollouts/${rollout.id}`);
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
    .select("rollout_id")
    .maybeSingle();
  if (error || !data) return fail("renameUnit", error ?? "unit not visible");
  revalidatePath("/rollouts");
  revalidatePath(`/rollouts/${data.rollout_id}`);
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
    .select("rollout_id")
    .maybeSingle();
  if (error || !data) return fail("deleteUnit", error ?? "unit not visible");
  revalidatePath("/rollouts");
  revalidatePath(`/rollouts/${data.rollout_id}`);
  return { ok: true };
}
