"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
import { pageDocumentSchema, PAGE_TOO_LARGE_ERROR, type PageDocument } from "./schema";
import { DEFAULT_PAGE } from "./defaults";
import { imagePathsIn, pageImagePrefix } from "./images";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[booking-page] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

/** Full zod validation plus the org-prefix rule for every image path. */
function validateDocument(input: unknown, orgId: string): PageDocument | null {
  const parsed = pageDocumentSchema.safeParse(input);
  if (!parsed.success) return null;
  const prefix = pageImagePrefix(orgId);
  if (!imagePathsIn(parsed.data).every((p) => p.startsWith(prefix))) return null;
  return parsed.data;
}

async function saveDraft(orgId: string, doc: PageDocument): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_page_draft", { p_org_id: orgId, p_doc: doc });
  if (error) {
    if (isRpcSentinel(error, "too large")) return { ok: false, error: PAGE_TOO_LARGE_ERROR };
    return fail("saveDraft", error);
  }
  return { ok: true };
}

export async function saveBookingPageDraft(input: unknown): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = validateDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  return saveDraft(orgId, doc);
}

/** Saves, then publishes — never depends on a pending autosave or an existing row. */
export async function publishBookingPage(input: unknown): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = validateDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  const saved = await saveDraft(orgId, doc);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_booking_page", { p_org_id: orgId });
  if (error) return fail("publishBookingPage", error);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function discardBookingPageDraft(): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE });
  if (error) return fail("discardBookingPageDraft", error);
  revalidatePath("/booking-page");
  return { ok: true };
}
