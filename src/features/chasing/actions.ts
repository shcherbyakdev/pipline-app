"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { startChaseInput, GENERIC_WRITE_ERROR } from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[chasing] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// Creates the chase row ONLY — it does not send. next_send_at = now means
// the drain's very next tick delivers send #0; one send path, not two.
export async function startChase(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = startChaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookups double as tenancy checks (RLS hides foreign rows); the
  // DB guard trigger re-validates the whole tuple.
  const { data: program } = await supabase
    .from("programs")
    .select("id, org_id")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (!program) return fail("startChase", "program not visible");

  const { data: participant } = await supabase
    .from("participants")
    .select("id, email")
    .eq("id", parsed.data.participantId)
    .maybeSingle();
  if (!participant) return fail("startChase", "participant not visible");
  if (!participant.email)
    return { ok: false, error: "This participant has no email address — add one first." };

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return fail("startChase", "no user");

  const { data, error } = await supabase
    .from("chases")
    .insert({
      org_id: program.org_id,
      participant_id: parsed.data.participantId,
      program_id: program.id,
      unit_id: parsed.data.unitId ?? null,
      next_send_at: new Date().toISOString(),
      created_by: me.user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "Already chasing this participant for this scope." };
    return fail("startChase", error);
  }
  revalidatePath(`/programs/${program.id}`);
  return { ok: true, id: data.id };
}
