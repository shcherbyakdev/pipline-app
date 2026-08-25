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

export type ChannelCatalog<S, T, O> = {
  services: S[];
  staff: T[];
  serviceStaffIds: Record<string, string[]>;
  offerings: O[];
};

export function applyChannel<S, T, O>(cat: ChannelCatalog<S, T, O>, channel: Channel | null): ChannelCatalog<S, T, O> {
  if (channel === "services" && cat.services.length > 0) return { ...cat, offerings: [] };
  if (channel === "spaces" && cat.offerings.length > 0) return { ...cat, services: [], staff: [], serviceStaffIds: {} };
  return cat;
}
