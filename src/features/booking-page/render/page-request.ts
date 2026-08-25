/* The section → widget hand-off, as data. A services or spaces card asks the
   booking widget to open on one thing; the key makes every ask distinct so
   picking the same card twice (after "change") still lands. Pure, so the
   provider stays a thin React shell. */
export type RequestKind = "service" | "offering";
export type PageRequest = { kind: RequestKind; id: string; key: number } | null;

export function initialRequest(serviceId: string | null): PageRequest {
  return serviceId ? { kind: "service", id: serviceId, key: 1 } : null;
}

export function nextRequest(prev: PageRequest, kind: RequestKind, id: string): PageRequest {
  return { kind, id, key: (prev?.key ?? 0) + 1 };
}
