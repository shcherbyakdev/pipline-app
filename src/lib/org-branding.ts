import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicLogoUrl } from "@/lib/storage/branding";

export type OrgBranding = { accentColor: string | null; logoUrl: string | null };

// Branding rides OUTSIDE the token RPCs on purpose: growing a RETURNS
// TABLE signature forces drop + recreate + re-grant of a battle-tested
// resolver for two display columns, and would put branding on the
// anon-reachable SQL surface. Both /p and /portal call this instead.
// Fails soft: an unbranded header beats a dead page.
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("accent_color, logo_path")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[branding] read failed:", error.message);
    return { accentColor: null, logoUrl: null };
  }
  return {
    accentColor: data.accent_color,
    logoUrl: data.logo_path ? publicLogoUrl(data.logo_path) : null,
  };
}
