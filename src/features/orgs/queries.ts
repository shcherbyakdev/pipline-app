import { createClient } from "@/lib/supabase/server";
import { publicLogoUrl } from "@/lib/storage/branding";

export type BrandingSettings = {
  orgId: string;
  orgName: string;
  accentColor: string | null;
  logoPath: string | null;
  logoUrl: string | null;
};

// RLS-scoped; single-org assumption matches the currentOrgId convention.
export async function getBrandingSettings(): Promise<BrandingSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, accent_color, logo_path")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    orgId: data.id,
    orgName: data.name,
    accentColor: data.accent_color,
    logoPath: data.logo_path,
    logoUrl: data.logo_path ? publicLogoUrl(data.logo_path) : null,
  };
}
