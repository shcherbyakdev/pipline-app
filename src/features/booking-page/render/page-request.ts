/* The section → widget hand-off, as data. A services or spaces card asks the
   booking widget to open on one thing; the key makes every ask distinct so
   picking the same card twice (after "change") still lands. Pure, so the
   provider stays a thin React shell. */
export type RequestKind = "service" | "offering";
export type PageRequest = { kind: RequestKind; id: string; key: number } | null;

export function initialRequest(serviceId: string | null, offeringId: string | null = null): PageRequest {
  if (serviceId) return { kind: "service", id: serviceId, key: 1 };
  if (offeringId) return { kind: "offering", id: offeringId, key: 1 };
  return null;
}

export function nextRequest(prev: PageRequest, kind: RequestKind, id: string): PageRequest {
  return { kind, id, key: (prev?.key ?? 0) + 1 };
}

/* The Team section's pick, separate from the catalogue's: a person and a
   service are chosen independently, so a new person must not wipe the
   service the way one catalogue card replaces another. `id: null` is
   "Anyone" — picking the chosen person again clears the choice. */
export type StaffRequest = { id: string | null; key: number } | null;

export function nextStaffRequest(prev: StaffRequest, id: string): StaffRequest {
  return { id: prev?.id === id ? null : id, key: (prev?.key ?? 0) + 1 };
}
