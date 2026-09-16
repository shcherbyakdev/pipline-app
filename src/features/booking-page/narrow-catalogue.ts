// Share links (spec 2026-09-16): `?service=` / `?space=` name one or more
// items of the gated, channel-filtered catalogue, comma-separated — and the
// page shows ONLY those. Pure: the hosted page and the embed narrow through
// here, the embed page's preview through previewFor on top of it, so the
// three can never disagree. Ids the catalogue doesn't list (unknown, inactive,
// plan-capped, the other channel) are dropped; a link naming none that
// survive degrades to the whole page instead of 404ing or going empty.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The uuids a query value names; a repeated key (`?space=a&space=b`) is
    off-shape and names nothing. */
export function parseIds(param: string | string[] | undefined): string[] {
  if (typeof param !== "string") return [];
  return param.split(",").filter((id) => UUID_RE.test(id));
}

export type Narrowed<S, O, P> = {
  services: S[];
  offerings: O[];
  staff: P[];
  /** Exactly one item was named: the page opens on it (the card shows
      pressed, the widget skips the list). Several: the visitor chooses. */
  initialServiceId: string | null;
  initialOfferingId: string | null;
};

export function narrowCatalogue<S extends { id: string }, O extends { id: string }, P extends { id: string }>(
  input: { services: readonly S[]; offerings: readonly O[]; staff: readonly P[]; serviceStaffIds: Record<string, string[]> },
  wanted: { services?: string[]; spaces?: string[] },
): Narrowed<S, O, P> {
  const listed = <T extends { id: string }>(items: readonly T[], ids: string[] | undefined) => {
    const want = new Set(ids ?? []);
    return want.size ? items.filter((x) => want.has(x.id)) : [];
  };
  const services = listed(input.services, wanted.services);
  const offerings = listed(input.offerings, wanted.spaces);
  // A narrowed service list also narrows the people: the page's Team section
  // must not offer someone who does none of what the link shows.
  const staff = services.length
    ? input.staff.filter((p) => services.some((s) => (input.serviceStaffIds[s.id] ?? []).includes(p.id)))
    : [...input.staff];
  return {
    services: services.length ? services : [...input.services],
    offerings: offerings.length ? offerings : [...input.offerings],
    staff,
    initialServiceId: services.length === 1 ? services[0]!.id : null,
    initialOfferingId: offerings.length === 1 ? offerings[0]!.id : null,
  };
}
