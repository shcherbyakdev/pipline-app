import type { Channel } from "./channel";

// The public booking page's address. Root-level since 0051 (/<handle>,
// /<handle>/<staffSlug>); /book/… only redirects. `appUrl` is passed in
// (NEXT_PUBLIC_APP_URL at the call site) so this module stays env-free.

export function bookingPath(handle: string, staffSlug?: string): string {
  return staffSlug ? `/${handle}/${staffSlug}` : `/${handle}`;
}

export function bookingUrl(appUrl: string, handle: string, staffSlug?: string): string {
  return `${appUrl.replace(/\/+$/, "")}${bookingPath(handle, staffSlug)}`;
}

// "https://booklo.co/" → "booklo.co": the prefix shown before a handle field.
export function hostLabel(appUrl: string): string {
  return appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/* Per-thing links (admin IA spec §5): what a link or embed opens on. A
   staff target is a path segment on the hosted page (/<handle>/<slug>) and
   a `?staff=` query on the embed — the two builders below know which;
   everything else is the same query on both. Slugged short links for
   services/spaces need a migration and stay deferred. */
export type LinkTarget =
  | { service: string }
  | { space: string }
  | { staff: string }
  | { channel: Channel }
  | null;

export function targetQuery(target?: LinkTarget): string {
  if (!target) return "";
  if ("service" in target) return `?service=${encodeURIComponent(target.service)}`;
  if ("space" in target) return `?space=${encodeURIComponent(target.space)}`;
  if ("channel" in target) return `?channel=${target.channel}`;
  return "";
}

export function bookingLink(appUrl: string, handle: string, target?: LinkTarget): string {
  if (target && "staff" in target) return bookingUrl(appUrl, handle, target.staff);
  return `${bookingUrl(appUrl, handle)}${targetQuery(target)}`;
}

export function embedSrc(appUrl: string, handle: string, target?: LinkTarget): string {
  const base = `${appUrl.replace(/\/+$/, "")}/embed/${handle}`;
  if (target && "staff" in target) return `${base}?staff=${encodeURIComponent(target.staff)}`;
  return `${base}${targetQuery(target)}`;
}
