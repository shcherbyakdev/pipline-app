import type { PageChannel } from "@/features/booking-page/channel";
import { channelPath, targetQuery } from "./url";

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

/** What the studio may promise about a channel. `admin` is what the org
    has bookable by its own rows; `pub` is the plan-limited public view
    (null = no cap applies). Capped = the org has it, the plan hides all of
    it — the studio then warns instead of offering a link that 404s. */
export function channelReach(channel: PageChannel, admin: Has, pub: Has | null): { reachable: boolean; capped: boolean } {
  const key = channel === "appointments" ? "services" : "spaces";
  const reachable = pub ? pub[key] : admin[key];
  return { reachable, capped: admin[key] && !reachable };
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

/** A root URL that asked for the spaces channel — `?channel=spaces`, or a
    pre-branch `?space=<id>` deep link — while the root is the appointments
    page: the path to send it to (the space preselected), else null. */
export function rootRedirect(
  handle: string,
  page: ChannelPage,
  has: Has,
  sp: { channel?: string | string[]; space?: string | string[] },
): string | null {
  if (page.channel !== "appointments" || !has.spaces) return null;
  const space = typeof sp.space === "string" && sp.space !== "" ? sp.space : null;
  if (!space && sp.channel !== "spaces") return null;
  return `${channelPath(handle, "spaces")}${space ? targetQuery({ space }) : ""}`;
}
