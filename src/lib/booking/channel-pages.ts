import type { PageChannel } from "@/features/booking-page/channel";

/* Which page /<handle> renders (spec 2026-08-28 §3.1, narrowed by 0073:
   one channel per org). Pure, decided on the GATED catalogue — mode ∩
   rentals flag ∩ bookable (an active service; a space with an active,
   plan-visible unit) — the same facts that make the page 404 when it is
   empty. At most one side of `has` is ever true. */
export type Has = { services: boolean; spaces: boolean };

/** The page /<handle> shows: appointments when a service is bookable,
    spaces when a space is, else null (404). The welcome checklist's
    "Publish" chip tracks the same page. */
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
