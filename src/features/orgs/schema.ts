import { z } from "zod";
import { SLOT_LAYOUTS, STAY_LAYOUTS, WIDGET_FONT_IDS } from "@/lib/widget-theme";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import type { OrgMode } from "./mode";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export const ORG_MODES = ["appointments", "rentals", "both"] as const;
export type OrgModeChoice = (typeof ORG_MODES)[number];

export function modeToFlags(mode: OrgModeChoice): OrgMode {
  return {
    offersAppointments: mode !== "rentals",
    offersRentals: mode !== "appointments",
  };
}

// Onboarding (spec 2026-08-23-landing-claim): org + handle + timezone in one
// step. Handle is optional — "" (untouched field) → null, as in
// schedulingSettingsInput. No mode here: every org is created as
// appointments and the wizard's first step (skippable) is where that
// changes, via update_org_modes.
export const createOrgWithPageSchema = z.object({
  name: z.string().trim().min(2).max(80),
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .union([z.string().regex(HANDLE_RE), z.null()])
      .refine((h) => h === null || !isReservedHandle(h), { message: "reserved handle" }),
  ),
  timezone: z.string().min(1).max(64),
});

export type OrgState = { error?: string };

// Normalised to lowercase — the orgs_accent_color_check CHECK expects it.
export const accentColorInput = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb")
  .transform((v) => v.toLowerCase())
  .nullable();
export const updateAccentInput = z.object({ accentColor: accentColorInput });

const hexField = z.string().regex(/^#[0-9a-f]{6}$/);
export const widgetThemeInput = z.object({
  theme: z.enum(["light", "dark", "auto"]),
  radius: z.enum(["none", "subtle", "round"]),
  font: z.enum(WIDGET_FONT_IDS),
  layout: z.enum(SLOT_LAYOUTS).optional(),
  stayLayout: z.enum(STAY_LAYOUTS).optional(),
  background: hexField.optional(),
  text: hexField.optional(),
  hidePoweredBy: z.boolean(),
});

/** One appearance per surface (spec 2026-09-02 §9): the hosted booking page
    and the website embed each keep their own theme, layouts and badge
    setting; they share only the widget UI. */
export const SURFACES = ["page", "embed"] as const;
export type Surface = (typeof SURFACES)[number];
export const surfaceThemeInput = z.object({ surface: z.enum(SURFACES), theme: widgetThemeInput });

export const updateOrgModesInput = z
  .object({ offersAppointments: z.boolean(), offersRentals: z.boolean() })
  .refine((v) => v.offersAppointments || v.offersRentals, "Keep at least one");

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
