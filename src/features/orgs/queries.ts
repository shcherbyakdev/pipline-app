import { createClient } from "@/lib/supabase/server";
import { publicLogoUrl } from "@/lib/storage/branding";

export type BrandingSettings = {
  orgId: string;
  orgName: string;
  accentColor: string | null;
  logoPath: string | null;
  logoUrl: string | null;
  widgetTheme: unknown;
};

// RLS-scoped; single-org assumption matches the currentOrgId convention.
export async function getBrandingSettings(): Promise<BrandingSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, accent_color, logo_path, widget_theme")
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
    widgetTheme: data.widget_theme,
  };
}

export async function getSchedulingSettings(): Promise<{
  orgId: string;
  handle: string | null;
  timezone: string;
  currency: string;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orgs")
    .select("id, handle, timezone, currency")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.id, handle: data.handle, timezone: data.timezone, currency: data.currency };
}
