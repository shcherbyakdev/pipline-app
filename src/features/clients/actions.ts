"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { generateAccessToken, buildPortalUrl } from "@/lib/tokens";
import { listClientsDirectory } from "./queries";
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
  // Read the prior client_id before the update: `.select()` on the update
  // below only returns the NEW row, and reassignment must also revalidate
  // the client detail page the unit is leaving.
  //
  // This read-then-write is NOT atomic. If two assignClient calls race on
  // the same unit, the loser's pre-read can capture a client_id that's
  // already stale by the time its update lands, so it revalidates the wrong
  // (or a no-longer-current) "departing" client page. The winner's own call
  // still revalidates correctly for whichever client_id was actually
  // current at ITS pre-read, and every call always revalidates its own
  // target (new) client correctly — a writer never fails to reflect its own
  // assignment. The residual failure mode is narrow: the departing client's
  // detail page can occasionally miss a revalidation under rapid overlapping
  // writes to the same unit, which self-heals on the next hard navigation
  // or action against that unit. `/clients/[id]` and `/programs/[id]` are
  // both dynamically rendered in production (they call cookies() for auth),
  // so there is no Full Route Cache entry to go permanently stale — the
  // exposure is limited to the client-side Router Cache on soft navigation.
  // A DB-level guard (advisory lock / SECURITY DEFINER RPC serializing the
  // read+write) would close this fully but is disproportionate for a
  // per-row admin control with no observed concurrent-editor usage; revisit
  // if multi-user concurrent editing of the same unit becomes real.
  const { data: before, error: beforeError } = await supabase
    .from("units")
    .select("client_id")
    .eq("id", parsed.data.unitId)
    .maybeSingle();
  if (beforeError || !before) return fail("assignClient", beforeError ?? "unit not visible");
  const { data, error } = await supabase
    .from("units")
    .update({ client_id: parsed.data.clientId })
    .eq("id", parsed.data.unitId)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("assignClient", error ?? "unit not visible");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath("/clients");
  const oldClientId = before.client_id;
  const newClientId = parsed.data.clientId;
  if (oldClientId) revalidatePath(`/clients/${oldClientId}`);
  if (newClientId && newClientId !== oldClientId) revalidatePath(`/clients/${newClientId}`);
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
    .eq("kind", "portal")
    .select("client_id")
    .maybeSingle();
  if (error || !data) return fail("revokePortalLink", error ?? "link not visible");
  revalidatePath(`/clients/${data.client_id}`);
  return { ok: true };
}

/** ⌘K palette: the client directory as search entries. Read-only, RLS-scoped
    to the caller's org; fetched once per palette session on first open. */
export async function clientsForCommandMenu(): Promise<
  Array<{ id: string; name: string; email: string | null }>
> {
  try {
    return (await listClientsDirectory()).map((c) => ({ id: c.id, name: c.name, email: c.email }));
  } catch (error) {
    console.error("[clients] clientsForCommandMenu:", error);
    return [];
  }
}
