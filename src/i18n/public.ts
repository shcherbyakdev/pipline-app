import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { Messages } from "use-intl/core";
import type { Locale } from "./config";
import { COUNTRY_HEADER, langFromPath, langParam, resolvePublicLocale } from "./public-locale";

export * from "./public-locale";

/** The resolved locale for this request. Pages pass their `searchParams`;
    server actions pass nothing and the `?lang=` is read back off the path
    the proxy stamped (`x-pathname` carries the query), so an action's error
    reads in the same language as the page that called it. */
export async function publicLocale(
  orgLocale: string | null | undefined,
  sp?: { lang?: string | string[] } | null,
): Promise<Locale> {
  const h = await headers();
  const lang = sp ? langParam(sp) : langFromPath(h.get("x-pathname"));
  return resolvePublicLocale({ lang, country: h.get(COUNTRY_HEADER), orgLocale });
}



/** The `errors.*` translator for a public server action, in the language
    the calling page resolved (spec §4: "resolved at the return site, never
    stored translated"). Pass the org's locale once it is known; before that
    (rate limit, malformed input) pass null — `?lang=` and the region still
    apply, then English. */
export type OrgLocaleSource = string | null | undefined | (() => Promise<string | null>);

export async function publicErrors(orgLocale: OrgLocaleSource) {
  const resolved = typeof orgLocale === "function" ? await orgLocale() : orgLocale;
  return getTranslations({ locale: await publicLocale(resolved), namespace: "errors" });
}

export type PublicErrorKey = keyof Messages["errors"];

/** A failed public action's result, its message in the page's language.
    `orgLocale` is null until the org is loaded (see publicErrors). */
export async function publicError<E extends object = Record<never, never>>(
  orgLocale: OrgLocaleSource,
  key: PublicErrorKey,
  extra?: E,
): Promise<{ ok: false; error: string } & E> {
  return { ok: false, error: (await publicErrors(orgLocale))(key), ...(extra as E) };
}
