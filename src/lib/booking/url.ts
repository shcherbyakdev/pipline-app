import type { Channel } from "./channel";
import type { PageChannel } from "@/features/booking-page/channel";

// The public booking page's address. Root-level since 0051 (/<handle>,
// /<handle>/<staffSlug>); /book/… only redirects. `appUrl` is passed in
// (NEXT_PUBLIC_APP_URL at the call site) so this module stays env-free.

export function bookingPath(handle: string, staffSlug?: string): string {
  return staffSlug ? `/${handle}/${staffSlug}` : `/${handle}`;
}

export function bookingUrl(appUrl: string, handle: string, staffSlug?: string): string {
  return `${appUrl.replace(/\/+$/, "")}${bookingPath(handle, staffSlug)}`;
}

// One page per channel (spec 2026-08-28 §3): the appointments page is the
// root, the spaces page a fixed segment below it — so a shared /spaces link
// keeps working when the org later adds a service and the root moves.
// "spaces" (and "appointments", kept free for symmetry) are reserved staff
// slugs for the same reason: the static segment wins over /[staffSlug].
export function channelPath(handle: string, channel: PageChannel): string {
  return channel === "spaces" ? `${bookingPath(handle)}/spaces` : bookingPath(handle);
}

export function channelUrl(appUrl: string, handle: string, channel: PageChannel): string {
  return `${appUrl.replace(/\/+$/, "")}${channelPath(handle, channel)}`;
}

// "https://booklo.co/" → "booklo.co": the prefix shown before a handle field.
export function hostLabel(appUrl: string): string {
  return appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/* Per-thing links (admin IA spec §5): what a link or embed opens on. A
   staff target is a path segment on the hosted page (/<handle>/<slug>) and
   a `?staff=` query on the embed — the two builders below know which;
   everything else is the same query on both. A channel target is that
   channel's page on the hosted side (channelUrl) and a ?channel= query on
   the embed. Slugged short links for services/spaces need a migration and
   stay deferred. */
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
  // A channel is a page of its own (spec 2026-08-28 §3.6); the embed below
  // keeps the query because the iframe is the widget, not a page.
  if (target && "channel" in target) return channelUrl(appUrl, handle, target.channel === "spaces" ? "spaces" : "appointments");
  return `${bookingUrl(appUrl, handle)}${targetQuery(target)}`;
}

export function embedSrc(appUrl: string, handle: string, target?: LinkTarget): string {
  const base = `${appUrl.replace(/\/+$/, "")}/embed/${handle}`;
  if (target && "staff" in target) return `${base}?staff=${encodeURIComponent(target.staff)}`;
  return `${base}${targetQuery(target)}`;
}
