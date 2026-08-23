import { z } from "zod";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

// Onboarding (spec 2026-08-23-landing-claim): org + handle + timezone in one
// step. Handle is optional — "" (untouched field) → null, as in
// schedulingSettingsInput.
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
  font: z.enum(["system", "inter", "dm-sans", "lora", "space-grotesk", "ibm-plex-mono"]),
  background: hexField.optional(),
  text: hexField.optional(),
  hidePoweredBy: z.boolean(),
});

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
