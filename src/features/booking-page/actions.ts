"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
import { matchesLogoMagicBytes } from "@/lib/storage/logo";
import { BRANDING_BUCKET, uploadBrandingObject } from "@/lib/storage/branding";
import { getPageDraftState, getPageSectionsEntitlement } from "./queries";
import { gatedVisibleSections } from "./gating";
import { parsePageDocument, PAGE_TOO_LARGE_ERROR, IMAGE_REJECTED_ERROR, PAGE_GATED_ERROR, type PageDocument } from "./schema";
import {
  PAGE_IMAGE_MAX_BYTES, isAllowedPageImageType, pageImagePathFor, pageImagePrefix, imagePathsIn, orphanPaths,
} from "./images";
import { DEFAULT_PAGE } from "./defaults";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[booking-page] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  if (error) console.error("[booking-page] currentOrgId:", error);
  return data?.id ?? null;
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
  const doc = parsePageDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  return saveDraft(orgId, doc);
}

/** Saves, then publishes — never depends on a pending autosave or an existing row. */
export async function publishBookingPage(input: unknown): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = parsePageDocument(input, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  const pageSections = await getPageSectionsEntitlement(orgId);
  if (gatedVisibleSections(doc, { pageSections }).length > 0) return { ok: false, error: PAGE_GATED_ERROR };
  const saved = await saveDraft(orgId, doc);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_booking_page", { p_org_id: orgId });
  if (error) return fail("publishBookingPage", error);
  // Published == draft now: anything else under the prefix is an orphan.
  await cleanupOrphans(orgId, doc, doc);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function discardBookingPageDraft(): Promise<ActionState> {
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_booking_page_draft", { p_org_id: orgId, p_fallback: DEFAULT_PAGE });
  if (error) return fail("discardBookingPageDraft", error);
  const state = await getPageDraftState(orgId);
  await cleanupOrphans(orgId, state.draft, state.published);
  revalidatePath("/booking-page");
  return { ok: true };
}

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

/** Uploads one page image and returns its storage path; the draft references
    it, nothing is written to the DB here. Mirrors uploadLogo: declared type
    → size → buffered size → magic bytes → content-hashed path → upsert. */
export async function uploadPageImage(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: GENERIC_WRITE_ERROR };
  if (file.size === 0 || file.size > PAGE_IMAGE_MAX_BYTES || !isAllowedPageImageType(file.type)) {
    return { ok: false, error: IMAGE_REJECTED_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const bytes = await file.arrayBuffer();
  // Re-check the buffered bytes, not just the File's reported size.
  if (bytes.byteLength === 0 || bytes.byteLength > PAGE_IMAGE_MAX_BYTES) return { ok: false, error: IMAGE_REJECTED_ERROR };
  // `branding` is a public, directly-navigable bucket: a relabeled file (SVG
  // as image/png) must be caught here, before it ever reaches storage.
  if (!matchesLogoMagicBytes(new Uint8Array(bytes), file.type)) return { ok: false, error: IMAGE_REJECTED_ERROR };
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = pageImagePathFor(orgId, checksum, file.type);
  if (!path) return { ok: false, error: IMAGE_REJECTED_ERROR };
  if (!(await uploadBrandingObject(path, bytes, file.type))) return { ok: false, error: GENERIC_WRITE_ERROR };
  return { ok: true, path };
}

/** Best-effort: delete objects under the org's page prefix that neither
    document references. Never throws, never fails the caller — the next
    publish/discard retries (evidence.ts orphan doctrine). */
async function cleanupOrphans(orgId: string, draft: PageDocument, published: PageDocument | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const prefix = pageImagePrefix(orgId);
    const { data, error } = await admin.storage.from(BRANDING_BUCKET).list(prefix.slice(0, -1), { limit: 1000 });
    if (error) {
      console.error("[booking-page] orphan list failed:", error.message);
      return;
    }
    const listed = (data ?? []).map((o) => `${prefix}${o.name}`);
    const referenced = [...imagePathsIn(draft), ...(published ? imagePathsIn(published) : [])];
    const orphans = orphanPaths(listed, referenced);
    if (orphans.length === 0) return;
    const { error: removeError } = await admin.storage.from(BRANDING_BUCKET).remove(orphans);
    if (removeError) console.error("[booking-page] orphan delete failed:", removeError.message);
  } catch (error) {
    console.error("[booking-page] orphan cleanup threw:", error);
  }
}
