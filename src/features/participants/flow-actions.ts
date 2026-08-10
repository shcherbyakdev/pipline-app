"use server";

import { revalidatePath } from "next/cache";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import {
  participantSaveResponseInput,
  participantClearResponseInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

// Participant writes ride the anon-callable RPCs — the token is the
// credential and SQL is the authority. Failures are uniform: no message
// distinguishes "bad token" from "out of scope" (the 404 discipline).
// NEVER log the token.
export async function submitResponse(input: unknown): Promise<ActionState> {
  const parsed = participantSaveResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("submit_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
    p_value_text: d.type === "text" || d.type === "choice" ? d.value : null,
    p_value_number: d.type === "number" ? d.value : null,
    p_value_bool: d.type === "boolean" ? d.value : null,
    p_value_date: d.type === "date" ? d.value : null,
  });
  if (error) {
    console.error("[participants] submitResponse:", error.code ?? "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

export async function clearResponse(input: unknown): Promise<ActionState> {
  const parsed = participantClearResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("clear_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
  });
  if (error) {
    console.error("[participants] clearResponse:", error.code ?? "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}
