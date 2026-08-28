import type { PageChannel } from "@/features/booking-page/channel";

/* Which page a public URL renders (spec 2026-08-28 §3.1). Pure, decided on
   the GATED catalogue — mode ∩ rentals flag ∩ bookable (an active service;
   a space with an active, plan-visible unit) — the same facts that make the
   page 404 today when both are empty. The rule is asymmetric on purpose: the
   root moves (appointments win it the moment a service is bookable) but
   /spaces never does, so a shared spaces link cannot break. */
export type Has = { services: boolean; spaces: boolean };

export type ChannelPage = { channel: PageChannel; canonical: "root" | "spaces" };

/** The page /<handle> shows: appointments when a service is bookable, else
    spaces, else null (404). The welcome checklist's "Publish" chip tracks
    the same page. */
export function frontDoor(has: Has): PageChannel | null {
  if (has.services) return "appointments";
  if (has.spaces) return "spaces";
  return null;
}

export function resolveChannelPage(route: "root" | "spaces", has: Has): ChannelPage | null {
  if (route === "root") {
    const channel = frontDoor(has);
    return channel ? { channel, canonical: "root" } : null;
  }
  if (!has.spaces) return null;
  // A spaces-only org's spaces page IS the root; /spaces still renders it
  // (links never break) but points its canonical at the root.
  return { channel: "spaces", canonical: has.services ? "spaces" : "root" };
}
