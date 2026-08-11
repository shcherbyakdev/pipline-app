"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateAccessToken, buildParticipantUrl } from "@/lib/tokens";
import {
  createParticipantInput,
  assignUnitInput,
  issueLinkInput,
  revokeLinkInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[participants] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createParticipant(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = createParticipantInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return fail("createParticipant", "no org");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("participants")
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return fail("createParticipant", error);
  revalidatePath("/programs");
  // The list this participant must appear in lives on the program page the
  // caller created them from; /programs alone would leave that stale.
  if (parsed.data.programId) revalidatePath(`/programs/${parsed.data.programId}`);
  return { ok: true, id: data.id };
}

export async function assignUnit(input: unknown): Promise<ActionState> {
  const parsed = assignUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({ assigned_participant_id: parsed.data.participantId })
    .eq("id", parsed.data.unitId)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("assignUnit", error ?? "unit not visible");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}

export async function issueLink(
  input: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = issueLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Parent lookup doubles as tenancy + org source (RLS hides foreign rows);
  // the DB guard trigger re-validates the whole scope tuple.
  const { data: program } = await supabase
    .from("programs")
    .select("id, org_id")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (!program) return fail("issueLink", "program not visible");

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return fail("issueLink", "no user");

  const { token, tokenHash } = generateAccessToken();
  const expiresAt = new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString();
  const { error } = await supabase.from("access_tokens").insert({
    org_id: program.org_id,
    token_hash: tokenHash,
    kind: "participant",
    participant_id: parsed.data.participantId,
    program_id: program.id,
    unit_id: parsed.data.unitId ?? null,
    expires_at: expiresAt,
    created_by: me.user.id,
  });
  if (error) return fail("issueLink", error);
  revalidatePath(`/programs/${program.id}`);
  // The raw token exists ONLY in this return value — shown once, never stored.
  return { ok: true, url: buildParticipantUrl(token) };
}

export async function revokeLink(input: unknown): Promise<ActionState> {
  const parsed = revokeLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("kind", "participant")
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("revokeLink", error ?? "link not visible");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}
