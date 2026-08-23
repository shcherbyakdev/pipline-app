import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import type { WidgetThemeConfig } from "@/lib/widget-theme";

/** Everything a section may need — and nothing a client component can't
    receive from a server one (plain data only, no functions). */
export type RenderContext = {
  org: { orgId: string; orgName: string; handle: string; timeZone: string };
  branding: { accentColor: string | null; logoUrl: string | null };
  /** Parsed widget theme; the booking section nests its own WidgetTheme with it. */
  theme: WidgetThemeConfig;
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds?: Record<string, string[]>;
  offerings: PublicOffering[];
  lockedStaff: PublicStaff | null;
  /** NEXT_PUBLIC_SUPABASE_URL — image paths resolve with pageImageUrl. */
  supabaseUrl: string;
  mode: "public" | "preview";
  /** Preview only: canned slots so the widget never fetches. */
  previewSlots?: string[];
};
