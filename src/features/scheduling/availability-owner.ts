import type { AvailabilityOwner } from "@/features/scheduling/schema";

/* Whose hours the Availability page shows (admin IA spec §3). Team members
   and hourly spaces are the same kind of owner here (ruling 4 — TIMIFY and
   Skedda treat staff and rooms as one lane type). Pure, so the fallback
   order is tested without a page around it. */
export type Owner =
  | { kind: "staff"; id: string; name: string; color: string }
  | { kind: "space"; id: string; name: string };

export type OwnerParams = { staff?: string; space?: string };
/** Structural minimums — a StaffRow / an OfferingRow satisfy them. */
export type PersonLike = { id: string; name: string; color: string };
export type SpaceLike = { id: string; name: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Order: a shape-valid `?staff=` naming a listed person → a shape-valid
    `?space=` naming a listed space → first person → first space → null.
    Callers pass ACTIVE people and ACTIVE HOURLY spaces only; anything else
    (a stale link, another org's id, a deactivated owner, a nightly space)
    quietly falls through — the page's existing forgiving rule, never a 404. */
export function resolveOwner(
  params: OwnerParams,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): Owner | null {
  const wantedPerson =
    params.staff && UUID_RE.test(params.staff) ? people.find((p) => p.id === params.staff) : undefined;
  if (wantedPerson) return person(wantedPerson);
  const wantedSpace =
    params.space && UUID_RE.test(params.space) ? spaces.find((s) => s.id === params.space) : undefined;
  if (wantedSpace) return space(wantedSpace);
  if (people[0]) return person(people[0]);
  if (spaces[0]) return space(spaces[0]);
  return null;
}

function person(p: PersonLike): Owner {
  return { kind: "staff", id: p.id, name: p.name, color: p.color };
}
function space(s: SpaceLike): Owner {
  return { kind: "space", id: s.id, name: s.name };
}

/** The `?staff=` / `?space=` link for an owner — OwnerTabs and the space
    detail page's "Edit hours →" both build their hrefs here. */
export function ownerHref(owner: { kind: Owner["kind"]; id: string }): string {
  return owner.kind === "staff" ? `/availability?staff=${owner.id}` : `/availability?space=${owner.id}`;
}

/** The editors' `owner` prop: a staff id XOR a space (rental offering) id. */
export function availabilityOwnerOf(owner: Owner): AvailabilityOwner {
  return owner.kind === "staff" ? { staffId: owner.id } : { rentalOfferingId: owner.id };
}
