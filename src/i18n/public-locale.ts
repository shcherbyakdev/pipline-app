import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/* Pure half of the public locale rules — safe to import from client
   components (public.ts adds the request-reading half on top).

   The public surfaces' locale — hosted page, embed, manage page and the
   server actions behind them (spec §4, amended 2026-09-02 for region
   detection). Resolution order:

     ?lang=<valid>  →  visitor's country  →  the org's locale  →  en

   REGION_LOCALES lists only countries whose language the product speaks and
   where it is unambiguous. Nothing maps to `en`, so the org's own choice is
   never overridden *towards* English: a Ukrainian business abroad sets `uk`
   on the Booking page Settings tab and every visitor gets it; a visitor
   browsing from Ukraine gets Ukrainian whatever the org chose. */
export const REGION_LOCALES: Readonly<Record<string, Locale>> = { UA: "uk" };

/** The header Vercel stamps with the visitor's ISO 3166-1 alpha-2 country;
    absent on localhost, so local runs fall through to the org locale. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

export function resolvePublicLocale(input: {
  lang: unknown;
  country: string | null | undefined;
  orgLocale: string | null | undefined;
}): Locale {
  if (isLocale(input.lang)) return input.lang;
  const byRegion = input.country ? REGION_LOCALES[input.country.toUpperCase()] : undefined;
  if (byRegion) return byRegion;
  return isLocale(input.orgLocale) ? input.orgLocale : DEFAULT_LOCALE;
}

/** `?lang=` as a page receives it: the first value when repeated, else the string. */
export function langParam(sp: { lang?: string | string[] } | null | undefined): string | undefined {
  const v = sp?.lang;
  return Array.isArray(v) ? v[0] : v;
}


export function langFromPath(path: string | null): string | undefined {
  const q = path?.indexOf("?") ?? -1;
  if (q === -1) return undefined;
  return new URLSearchParams(path!.slice(q + 1)).get("lang") ?? undefined;
}

/** Appends an explicit `?lang=` to a public href so the override survives
    the cross-links between the org's pages. Only an explicit override is
    carried: a locale that came from the region or the org resolves the same
    way on the next page and needs no query. */
export function withLang(href: string, lang: string | undefined): string {
  if (!isLocale(lang)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}lang=${lang}`;
}

/** The current public URL with `?lang=` set to `locale` — the href behind
    each entry of the visitor's language links. Any `lang` already on the
    URL is replaced, every other query value survives (a `?service=` deep
    link keeps its service when the visitor switches language). `path` is
    the proxy's `x-pathname` (pathname + search); when it is missing, a bare
    `?lang=` still resolves against whatever page is rendering it. */
export function langHref(path: string | null | undefined, locale: Locale): string {
  const [base = "", query = ""] = (path ?? "").split("?");
  const params = new URLSearchParams(query);
  params.set("lang", locale);
  return `${base}?${params.toString()}`;
}
