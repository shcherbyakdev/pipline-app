import type { OrgMode } from "@/features/orgs/mode";

/* The stored page channel (spec 2026-08-28 §1): the booking_pages row for
   the org's one channel (0073). Distinct on purpose from OrgMode's Channel
   ("appointments" | "rentals" — what the org sells); pageChannelMode is the
   bridge. lib/booking/channel-pages.ts imports PageChannel from here
   (type-only) — a deliberate downward share, so the routing rule speaks the
   page's word. */
export const PAGE_CHANNELS = ["appointments", "spaces"] as const;
export type PageChannel = (typeof PAGE_CHANNELS)[number];

/** The single-channel OrgMode a page renders with — fitToMode, addableTypes
    and the preview catalogue all take it, so a page only ever shows its own
    channel. */
export function pageChannelMode(channel: PageChannel): OrgMode {
  return { offersAppointments: channel === "appointments", offersRentals: channel === "spaces" };
}

/** A stored `booking_pages.channel`: one of the two words, else null. */
export function parsePageChannel(raw: unknown): PageChannel | null {
  return raw === "appointments" || raw === "spaces" ? raw : null;
}
