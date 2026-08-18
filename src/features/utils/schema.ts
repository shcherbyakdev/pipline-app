import { z } from "zod";

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
