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

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
