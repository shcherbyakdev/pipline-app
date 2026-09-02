// The list of languages the product speaks (spec 2026-09-02 §10: adding one
// is a line here, a loader line in messages.ts and a messages/<code>.json).
// Codes are ISO 639-1 language codes — Ukrainian is `uk`, never `ua`.
export const LOCALES = ["en", "uk"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself. Shown in the switcher; never translated. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", uk: "Українська" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Accept-Language → the best supported locale by q-value, matching on the
    base language only ("uk-UA" → "uk"). Unknown, empty or zero-weight → the
    default. Tiny on purpose: two locales do not need a matcher library. */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r) => r.lang !== "" && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const r of ranked) if (isLocale(r.lang)) return r.lang;
  return DEFAULT_LOCALE;
}
