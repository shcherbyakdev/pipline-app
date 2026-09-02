/* `?channel=services|spaces` (admin IA spec §5, ruling 7): one link that
   shows one channel of the public catalogue. Pure — the two public routes
   apply it to the gated catalogue BEFORE the widget, its group headings and
   the builder sections read it, so all of them agree. Degrades by what the
   catalogue actually holds: a channel with nothing in it (mode off, feature
   flag off, or simply nothing active) yields the full catalogue — never a
   404, never an empty widget. */
export type Channel = "services" | "spaces";

export function resolveChannelParam(param: string | string[] | undefined): Channel | null {
  return param === "services" || param === "spaces" ? param : null;
}

/** What an embed URL asks for: `?channel=` first; else a per-space or
    per-service deep link implies its channel, so snippets pasted before
    embeds became one channel keep opening on their space or service. */
export function requestedEmbedChannel(sp: { channel?: string | string[]; space?: string | string[]; service?: string | string[] }): Channel | null {
  const explicit = resolveChannelParam(sp.channel);
  if (explicit) return explicit;
  if (typeof sp.space === "string" && sp.space !== "") return "spaces";
  if (typeof sp.service === "string" && sp.service !== "") return "services";
  return null;
}

export type ChannelCatalog<S, T, O> = {
  services: S[];
  staff: T[];
  serviceStaffIds: Record<string, string[]>;
  offerings: O[];
};

/** The embed is always ONE channel (2026-09-02 ruling — the hosted pages
    are), so `?channel=` never falls back to the whole catalogue: the
    requested channel when it has something bookable, else the front door
    (appointments when a service is bookable, else spaces — the hosted
    root's rule), else null when nothing is bookable at all. */
export function embedChannel(has: { services: boolean; spaces: boolean }, requested: Channel | null): Channel | null {
  if (requested === "spaces" && has.spaces) return "spaces";
  if (requested === "services" && has.services) return "services";
  if (has.services) return "services";
  if (has.spaces) return "spaces";
  return null;
}

export function applyChannel<S, T, O>(cat: ChannelCatalog<S, T, O>, channel: Channel | null): ChannelCatalog<S, T, O> {
  if (channel === "services" && cat.services.length > 0) return { ...cat, offerings: [] };
  if (channel === "spaces" && cat.offerings.length > 0) return { ...cat, services: [], staff: [], serviceStaffIds: {} };
  return cat;
}
