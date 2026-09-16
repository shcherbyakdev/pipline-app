import type { OrgMode } from "@/features/orgs/mode";
import type { LinkTarget } from "@/lib/booking/url";

/* The embed page's Show select, as data (share links, spec 2026-09-16):
   the page, one person, or a ticked list of services / spaces. Pure — the
   page hands in ACTIVE people (only when the team has more than one; a solo
   team's link is the page), bookable services and active spaces, already
   filtered; this gates them by channel and hides a list with nothing to
   choose between. The component turns the pick into a link (bookingLink)
   and a snippet (embedSnippet); names are the things' own, the fixed
   entries are message keys (`embed.rows.*`, `embed.pick.*`). */
export type ShowItem = { id: string; name: string };
export type ShowOptions = {
  people: { slug: string; name: string }[];
  /** Listed only when there is something to choose between (2+). */
  services: ShowItem[];
  spaces: ShowItem[];
};

export type EmbedPick = {
  /** "page", "staff:<slug>", "services" or "spaces". */
  show: string;
  /** The ticked services or spaces (whichever `show` names). */
  ids: string[];
  /** A pinned language; "" = follow the visitor. */
  lang: string;
  /** "light" | "dark" pins the embed's theme to the host page; "" keeps the
      booking page's own. Nothing here is stored — all of it is part of the
      string you copy (spec 2026-09-16). */
  theme: string;
};

export function showOptions(input: {
  mode: OrgMode;
  staff: readonly { slug: string; name: string }[];
  services: readonly ShowItem[];
  spaces: readonly ShowItem[];
}): ShowOptions {
  const many = <T,>(items: readonly T[]) => (items.length > 1 ? [...items] : []);
  return {
    people: input.mode.offersAppointments ? [...input.staff] : [],
    services: input.mode.offersAppointments ? many(input.services) : [],
    spaces: input.mode.offersRentals ? many(input.spaces) : [],
  };
}

/** Whether the Show select has anything to offer beyond the page. */
export function hasChoice(o: ShowOptions): boolean {
  return o.people.length + o.services.length + o.spaces.length > 0;
}

/* The pick as a link target. Ticks come out in option order (the order the
   page lists them) and anything the options don't list is dropped; a list
   with nothing ticked is the page — the hint under the list says so. */
export function pickTarget(pick: EmbedPick, o: ShowOptions): LinkTarget {
  if (pick.show.startsWith("staff:")) {
    const slug = pick.show.slice("staff:".length);
    return o.people.some((p) => p.slug === slug) ? { staff: slug } : null;
  }
  const ticked = (items: ShowItem[]) => items.filter((i) => pick.ids.includes(i.id)).map((i) => i.id);
  if (pick.show === "services") {
    const ids = ticked(o.services);
    return ids.length ? { services: ids } : null;
  }
  if (pick.show === "spaces") {
    const ids = ticked(o.spaces);
    return ids.length ? { spaces: ids } : null;
  }
  return null;
}

/* What the Team, Service and Space pages' Embed links land on: ?staff=<slug>
   picks that person; ?service= / ?space= (one id, or a comma list — the
   public pages' own shape) tick those items. Anything the options don't
   list (unknown, the other channel, repeated) is the page. */
export function initialPick(o: ShowOptions, params: Record<string, string | string[] | undefined>): EmbedPick {
  const page: EmbedPick = { show: "page", ids: [], lang: "", theme: "" };
  const { staff, service, space } = params;
  if (typeof staff === "string" && o.people.some((p) => p.slug === staff)) return { ...page, show: `staff:${staff}` };
  const ids = (value: string | string[] | undefined, items: ShowItem[]) =>
    typeof value === "string" ? value.split(",").filter((id) => items.some((i) => i.id === id)) : [];
  const services = ids(service, o.services);
  if (services.length) return { ...page, show: "services", ids: services };
  const spaces = ids(space, o.spaces);
  if (spaces.length) return { ...page, show: "spaces", ids: spaces };
  return page;
}
