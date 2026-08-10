import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Object I/O for the PUBLIC `branding` bucket (ZERO storage policies —
// writes only through the service-role client; reads are public URLs, so
// no signing on every portal load). Logos are not secrets. Validation caps
// (mime allowlist, size, path builder) live in ./logo instead of here: this
// module carries `server-only` for the admin client, and a client component
// (branding-form.tsx) needs those pure checks before any bytes move — the
// evidence.ts/photo.ts split, restated.
export const BRANDING_BUCKET = "branding";

export function publicLogoUrl(path: string): string {
  const admin = createAdminClient();
  return admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}

// upsert: same bytes → same path (logoPathFor in ./logo is content-hashed),
// so re-uploading an identical logo is a no-op rather than an error.
export async function uploadBrandingObject(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(BRANDING_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error("[storage] logo upload failed:", error.message);
    return false;
  }
  return true;
}

// Best-effort: a failed delete leaves an orphan (accepted wart — the
// evidence.ts precedent). Never throws.
export async function deleteBrandingObject(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BRANDING_BUCKET).remove([path]);
  if (error) console.error("[storage] orphaned logo, delete failed:", error.message);
}
