import { withLang } from "@/i18n/public-locale";

// The public booking page's address. Root-level since 0051 (/<handle>,
// /<handle>/<staffSlug>); /book/… only redirects. `appUrl` is passed in
// (NEXT_PUBLIC_APP_URL at the call site) so this module stays env-free.

export function bookingPath(handle: string, staffSlug?: string): string {
  return staffSlug ? `/${handle}/${staffSlug}` : `/${handle}`;
}

export function bookingUrl(appUrl: string, handle: string, staffSlug?: string): string {
  return `${appUrl.replace(/\/+$/, "")}${bookingPath(handle, staffSlug)}`;
}

/** The query a redirect carries across (a renamed handle, a typed-in
    capital): the string-valued params, re-encoded. */
export function queryOf(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : []))).toString();
  return qs ? `?${qs}` : "";
}

// "https://booklo.co/" → "booklo.co": the prefix shown before a handle field.
export function hostLabel(appUrl: string): string {
  return appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/* Share links (spec 2026-09-16): what a link or embed shows. A staff target
   is a path segment on the hosted page (/<handle>/<slug>) and a `?staff=`
   query on the embed — the two builders below know which; the list targets
   are the same query on both: the page narrowed to those services or
   spaces (one id is the old single-item link, and still valid). Slugged
   short links for services/spaces need a migration and stay deferred. */
export type LinkTarget =
  | { services: string[] }
  | { spaces: string[] }
  | { staff: string }
  | null;

export function targetQuery(target?: LinkTarget): string {
  if (!target) return "";
  const list = (key: string, ids: string[]) => (ids.length ? `?${key}=${ids.map(encodeURIComponent).join(",")}` : "");
  if ("services" in target) return list("service", target.services);
  if ("spaces" in target) return list("space", target.spaces);
  return "";
}

export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string {
  if (target && "staff" in target) return bookingUrl(appUrl, handle, target.staff);
  return `${bookingUrl(appUrl, handle)}${targetQuery(target)}`;
}

/* `lang` pins the snippet to one language (i18n spec §4, amended
   2026-09-03): the widget sits on someone else's page, so that page's owner
   picks — there is no switcher inside the iframe. Omitted (the default), the
   embed follows the visitor's region and then the org, exactly as before. */
export function embedSrc(appUrl: string, handle: string, target?: LinkTarget, lang?: string): string {
  const base = `${appUrl.replace(/\/+$/, "")}/embed/${handle}`;
  if (target && "staff" in target) return withLang(`${base}?staff=${encodeURIComponent(target.staff)}`, lang);
  return withLang(`${base}${targetQuery(target)}`, lang);
}
