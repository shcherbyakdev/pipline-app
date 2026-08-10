"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { generateAccessToken, buildPortalUrl } from "@/lib/tokens";
import {
  createClientInput,
  renameClientInput,
  deleteClientInput,
  assignClientInput,
  issuePortalLinkInput,
  revokePortalLinkInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[clients] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createSupabase();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createClient(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = createClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return fail("createClient", "no org");
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .insert({ org_id: orgId, name: parsed.data.name })
    .select("id")
    .single();
  if (error || !data) return fail("createClient", error);
  revalidatePath("/clients");
  if (parsed.data.programId) revalidatePath(`/programs/${parsed.data.programId}`);
  return { ok: true, id: data.id };
}

export async function renameClient(input: unknown): Promise<ActionState> {
  const parsed = renameClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("renameClient", error ?? "client not visible");
  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.id}`);
  return { ok: true };
}

// Cascade is deliberate (spec): portal tokens die with the client; units
// keep their history and lose only the grouping (set null). The confirm
// dialog spells this out.
export async function deleteClient(input: unknown): Promise<ActionState> {
  const parsed = deleteClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("deleteClient", error ?? "client not visible");
  revalidatePath("/clients");
  revalidatePath("/programs", "layout"); // unit rows show client pickers
  redirect("/clients");
}

export async function assignClient(input: unknown): Promise<ActionState> {
  const parsed = assignClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("units")
    .update({ client_id: parsed.data.clientId })
    .eq("id", parsed.data.unitId)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("assignClient", error ?? "unit not visible");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath("/clients");
  return { ok: true };
}

export async function issuePortalLink(
  input: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = issuePortalLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  // Parent lookup doubles as tenancy + org source (RLS hides foreign rows);
  // the DB guard trigger re-validates the scope tuple.
  const { data: client } = await supabase
    .from("clients")
    .select("id, org_id")
    .eq("id", parsed.data.clientId)
    .maybeSingle();
  if (!client) return fail("issuePortalLink", "client not visible");

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return fail("issuePortalLink", "no user");

  const { token, tokenHash } = generateAccessToken();
  const expiresAt = new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString();
  const { error } = await supabase.from("access_tokens").insert({
    org_id: client.org_id,
    token_hash: tokenHash,
    kind: "portal",
    client_id: client.id,
    expires_at: expiresAt,
    created_by: me.user.id,
  });
  if (error) return fail("issuePortalLink", error);
  revalidatePath(`/clients/${client.id}`);
  // The raw token exists ONLY in this return value — shown once, never stored.
  return { ok: true, url: buildPortalUrl(token) };
}

export async function revokePortalLink(input: unknown): Promise<ActionState> {
  const parsed = revokePortalLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("client_id")
    .maybeSingle();
  if (error || !data) return fail("revokePortalLink", error ?? "link not visible");
  revalidatePath(`/clients/${data.client_id}`);
  return { ok: true };
}
