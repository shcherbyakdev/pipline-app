import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import type { ClientContact } from "@/features/orgs/schema";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import type { SectionType } from "../schema";

/** The empty-field placeholders the preview shows (`studio.ghost.*`). */
export const GHOST_KEYS = ["headline", "cover", "about", "services", "spaces", "staff", "address", "link", "faq", "gallery", "testimonial"] as const;
export type GhostKey = (typeof GHOST_KEYS)[number];

/** Studio chrome drawn INSIDE the preview — the section chips and the ghost
    placeholders. Resolved by the builder in the ADMIN's language: the preview
    subtree's own provider speaks the org's (public messages only), so nothing
    in here may call useTranslations("studio"). Plain strings, per type. */
export type PreviewChrome = {
  sections: Record<SectionType, { label: string; edit: string }>;
  hidden: string;
  ghost: Record<GhostKey, string>;
};

/** Everything a section may need — and nothing a client component can't
    receive from a server one (plain data only, no functions). */
export type RenderContext = {
  org: { orgId: string; orgName: string; handle: string; timeZone: string; currency: string; clientContact: ClientContact };
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
  /** The link to the org's other channel page, when one is bookable (spec
      2026-08-28 §3.5); placed by crossLinkHost. `href` is "#" in preview. */
  crossLink: { href: string; label: string } | null;
  /** Preview only: canned slots so the widget never fetches. */
  previewSlots?: string[];
  /** Preview only: the studio's chrome, in the admin's words. */
  preview?: PreviewChrome;
};
