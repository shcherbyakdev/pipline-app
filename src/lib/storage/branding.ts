import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Object I/O for the PUBLIC `branding` bucket (ZERO storage policies —
// writes only through the service-role client; reads are public URLs, so
// no signing on every portal load). Logos are not secrets. Task 9 adds
// upload/delete + validation caps to this module.
export const BRANDING_BUCKET = "branding";

export function publicLogoUrl(path: string): string {
  const admin = createAdminClient();
  return admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}
