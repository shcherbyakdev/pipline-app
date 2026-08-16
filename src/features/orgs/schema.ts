import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
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
