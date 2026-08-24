import { z } from "zod";
import { FLAG_KEYS } from "@/lib/flags";

/* Inputs for the internal utilities. Everything is owner-typed, so the
   schemas are permissive about content and strict about shape. */

/** Free-text org search. Letters, digits, space, dash, underscore, dot — the
    characters a name/slug/handle can contain. Anything else is dropped rather
    than rejected: it goes into a PostgREST `ilike` pattern, and `%`, `,` and
    `(` would change the query's meaning.

    Over-long input is TRUNCATED for the same reason it is stripped rather
    than rejected: `q` arrives from a URL the owner can edit by hand, and the
    honest answer to a 200-character paste is the first 80 characters' worth
    of matches, not a thrown ZodError that renders as an error page. The
    length cap runs BEFORE the strip so the bound is on what reaches Postgres. */
export const orgSearchInput = z.object({
  q: z
    .string()
    .trim()
    .transform((s) => s.slice(0, 80))
    .transform((s) => s.replace(/[^\p{L}\p{N} ._-]/gu, "")),
});

export const orgIdInput = z.object({ org: z.uuid() });

/** Today as YYYY-MM-DD in UTC — the calendar `expires` is read in (the form
    says "UTC", the action turns it into end-of-day UTC), so it is the day
    the past/future line is drawn on. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `expires` is a calendar date (YYYY-MM-DD) or empty for "no expiry"; the
    action turns it into end-of-day UTC. A date already past is refused
    rather than saved: it would write a comp that is expired on arrival —
    the panel would read "expired", /billing would show nothing, and the
    owner would be left wondering whether the grant took. Same-day is fine
    (end-of-day UTC is still ahead). ISO dates compare as strings.

    `abort: true` on the format check: zod 4 keeps running later checks after
    a failure, so without it a malformed date would ALSO fail the refine and
    the action (which keys on the refine's `custom` issue) would call it
    "past" instead of "invalid". */
export const grantOverrideInput = z.object({
  org: z.uuid(),
  plan: z.enum(["pro", "team"]),
  expires: z.union([
    z.literal(""),
    z.string().date({ abort: true }).refine((d) => d >= todayUtc(), { message: "Expiry must be today or later." }),
  ]),
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
  expires_past: "Expiry must be today or later.",
} as const;

export function utilsDoneMessage(code: string): string | null {
  return code in UTILS_DONE ? UTILS_DONE[code as keyof typeof UTILS_DONE] : null;
}
export function utilsErrorMessage(code: string): string | null {
  return code in UTILS_ERRORS ? UTILS_ERRORS[code as keyof typeof UTILS_ERRORS] : null;
}
