import type { OrgMode } from "@/features/orgs/mode";
import type { Channel as CatalogChannel } from "@/lib/booking/channel";

/* The stored page channel (spec 2026-08-28 §1): one booking_pages row per
   channel an org sells. Distinct on purpose from OrgMode's Channel
   ("appointments" | "rentals" — what the org sells) and lib/booking/channel's
   Channel ("services" | "spaces" — the ?channel= query the widget-only
   embed still takes); these two mappers are the only bridges.
   lib/booking/url.ts and channel-pages.ts import PageChannel from here
   (type-only) — a deliberate downward share, so the URL builders and the
   routing rule speak the page's word. */
export const PAGE_CHANNELS = ["appointments", "spaces"] as const;
export type PageChannel = (typeof PAGE_CHANNELS)[number];

/** The single-channel OrgMode a page renders with — fitToMode, addableTypes
    and the preview catalogue all take it, so a page only ever shows its own
    channel. */
export function pageChannelMode(channel: PageChannel): OrgMode {
  return { offersAppointments: channel === "appointments", offersRentals: channel === "spaces" };
}

/** The word applyChannel understands, for forcing the public catalogue. */
export function toCatalogChannel(channel: PageChannel): CatalogChannel {
  return channel === "appointments" ? "services" : "spaces";
}

/** `?page=` on the builder: one of the two words, else null. */
export function parsePageChannel(raw: unknown): PageChannel | null {
  return raw === "appointments" || raw === "spaces" ? raw : null;
}
