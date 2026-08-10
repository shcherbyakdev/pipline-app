import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Object I/O for the private `evidence` bucket (ZERO storage policies — the
// service-role client is the only way in). This module signs and moves
// bytes; it NEVER authorizes: callers pass paths that already came out of
// an RLS-scoped select or a token-scoped read (the admin.ts contract).
export const EVIDENCE_BUCKET = "evidence";
const SIGNED_URL_TTL_SECONDS = 600;

export async function uploadEvidenceObject(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) {
    console.error("[storage] upload failed:", error.message);
    return false;
  }
  return true;
}

// Best-effort: a failed object delete leaves an orphan (accepted v1 wart —
// the metadata row, already gone by now, is the record). Never throws.
export async function deleteEvidenceObject(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(EVIDENCE_BUCKET).remove([path]);
  if (error) console.error("[storage] orphaned object, delete failed:", error.message);
}

export async function signEvidencePaths(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    // Degrade to filename tiles rather than failing the page.
    console.error("[storage] sign failed:", error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  }
  return map;
}
