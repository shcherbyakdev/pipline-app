import { z } from "zod";
import { FLAG_KEYS } from "@/lib/flags";

/* Inputs for the internal utilities. Everything is owner-typed, so the
   schemas are permissive about content and strict about shape. */

/** Free-text org search. Letters, digits, space, dash, underscore, dot — the
    characters a name/slug/handle can contain. Anything else is dropped rather
    than rejected: it goes into a PostgREST `ilike` pattern, and `%`, `,` and
    `(` would change the query's meaning. */
export const orgSearchInput = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s.replace(/[^\p{L}\p{N} ._-]/gu, "")),
});

export const orgIdInput = z.object({ org: z.uuid() });

/** `expires` is a calendar date (YYYY-MM-DD) or empty for "no expiry"; the
    action turns it into end-of-day UTC. */
export const grantOverrideInput = z.object({
  org: z.uuid(),
  plan: z.enum(["pro", "team"]),
  expires: z.union([z.literal(""), z.string().date()]),
  note: z.string().trim().max(200),
});

export const revokeOverrideInput = orgIdInput;

/** "default" deletes the row; "on"/"off" upsert it. */
export const setFlagInput = z.object({
  org: z.uuid(),
  flag: z.enum(FLAG_KEYS as [string, ...string[]]),
  value: z.enum(["default", "on", "off"]),
});

export const UTILS_DONE = {
  granted: "Complimentary plan saved.",
  revoked: "Complimentary plan revoked — the provider row (or Free) is in effect again.",
  flag_set: "Flag saved.",
} as const;
export const UTILS_ERRORS = {
  invalid: "That didn't validate — check the fields and try again.",
} as const;

export function utilsDoneMessage(code: string): string | null {
  return code in UTILS_DONE ? UTILS_DONE[code as keyof typeof UTILS_DONE] : null;
}
export function utilsErrorMessage(code: string): string | null {
  return code in UTILS_ERRORS ? UTILS_ERRORS[code as keyof typeof UTILS_ERRORS] : null;
}
