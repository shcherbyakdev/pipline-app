"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
import { matchesLogoMagicBytes } from "@/lib/storage/logo";
import { BRANDING_BUCKET, uploadBrandingObject } from "@/lib/storage/branding";
import { getPageStates, getPageSectionsEntitlement } from "./queries";
import { gatedVisibleSections } from "./gating";
import { PAGE_CHANNELS, type PageChannel } from "./channel";
import {
  parsePageDocument, PAGE_TOO_LARGE_ERROR, IMAGE_REJECTED_ERROR, IMAGE_LIMIT_ERROR, PAGE_GATED_ERROR, type PageDocument,
} from "./schema";
import {
  PAGE_IMAGE_MAX_BYTES, PAGE_IMAGE_MAX_OBJECTS, isAllowedPageImageType, pageImagePathFor, pageImagePrefix,
  imagePathsIn, orphanPaths,
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

// Every write names its page. `doc` stays `unknown` here: parsePageDocument
// owns the document's shape (and its org-scoped image-path check).
const pageWriteInput = z.object({ channel: z.enum(PAGE_CHANNELS), doc: z.unknown() });
const pageChannelInput = z.object({ channel: z.enum(PAGE_CHANNELS) });

async function saveDraft(orgId: string, channel: PageChannel, doc: PageDocument): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_page_draft", { p_org_id: orgId, p_channel: channel, p_doc: doc });
  if (error) {
    if (isRpcSentinel(error, "too large")) return { ok: false, error: PAGE_TOO_LARGE_ERROR };
    return fail("saveDraft", error);
  }
  return { ok: true };
}

export async function saveBookingPageDraft(input: unknown): Promise<ActionState> {
  const parsed = pageWriteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = parsePageDocument(parsed.data.doc, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  return saveDraft(orgId, parsed.data.channel, doc);
}

/** Saves, then publishes — never depends on a pending autosave or an existing row. */
export async function publishBookingPage(input: unknown): Promise<ActionState> {
  const parsed = pageWriteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const doc = parsePageDocument(parsed.data.doc, orgId);
  if (!doc) return { ok: false, error: GENERIC_WRITE_ERROR };
  const pageSections = await getPageSectionsEntitlement(orgId);
  if (gatedVisibleSections(doc, { pageSections }).length > 0) return { ok: false, error: PAGE_GATED_ERROR };
  const saved = await saveDraft(orgId, parsed.data.channel, doc);
  if (!saved.ok) return saved;
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_booking_page", { p_org_id: orgId, p_channel: parsed.data.channel });
  if (error) return fail("publishBookingPage", error);
  await cleanupOrphans(orgId);
  revalidatePath("/booking-page");
  return { ok: true };
}

export async function discardBookingPageDraft(input: unknown): Promise<ActionState> {
  const parsed = pageChannelInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_booking_page_draft", {
    p_org_id: orgId, p_channel: parsed.data.channel, p_fallback: DEFAULT_PAGE,
  });
  if (error) return fail("discardBookingPageDraft", error);
  await cleanupOrphans(orgId);
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
  // Per-org ceiling. Re-uploading bytes already stored is a no-op upsert on
  // the same path, so it is never refused. Orphans are NOT swept here: an
  // image uploaded seconds ago may be referenced only by the client's
  // not-yet-autosaved draft, and a sweep against the saved one would delete
  // it — publish/discard are the safe moments (they see the final document).
  const listed = await listPageObjects(orgId);
  if (listed === null) return { ok: false, error: GENERIC_WRITE_ERROR };
  if (listed.length >= PAGE_IMAGE_MAX_OBJECTS && !listed.includes(path)) {
    return { ok: false, error: IMAGE_LIMIT_ERROR };
  }
  if (!(await uploadBrandingObject(path, bytes, file.type))) return { ok: false, error: GENERIC_WRITE_ERROR };
  return { ok: true, path };
}

/** Every object under the org's page prefix, as full paths. Storage lists
    are paged (1000 by default), so keep pulling until a short page — the cap
    above is meaningless if the count silently stops at page one. Null on a
    storage error (already logged). */
async function listPageObjects(orgId: string): Promise<string[] | null> {
  const admin = createAdminClient();
  const prefix = pageImagePrefix(orgId);
  const PAGE = 1000;
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage
      .from(BRANDING_BUCKET)
      .list(prefix.slice(0, -1), { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.error("[booking-page] page image list failed:", error.message);
      return null;
    }
    const page = data ?? [];
    for (const o of page) paths.push(`${prefix}${o.name}`);
    if (page.length < PAGE) return paths;
  }
}

/** Best-effort: delete objects under the org's page prefix that no page —
    any channel, draft or published — references. Reads the rows back after
    the write so the sweep sees exactly what the DB holds. Never throws,
    never fails the caller — the next publish/discard retries (evidence.ts
    orphan doctrine). */
async function cleanupOrphans(orgId: string): Promise<void> {
  try {
    const listed = await listPageObjects(orgId);
    if (listed === null) return;
    const states = Object.values(await getPageStates(orgId));
    const referenced = states.flatMap((s) => [...imagePathsIn(s.draft), ...(s.published ? imagePathsIn(s.published) : [])]);
    const orphans = orphanPaths(listed, referenced);
    if (orphans.length === 0) return;
    const { error: removeError } = await createAdminClient().storage.from(BRANDING_BUCKET).remove(orphans);
    if (removeError) console.error("[booking-page] orphan delete failed:", removeError.message);
  } catch (error) {
    console.error("[booking-page] orphan cleanup threw:", error);
  }
}
