// Which services a public surface may actually offer.
//
// Since the team slice a service is only bookable through the people linked to
// it (`service_staff`), and only while those people are active: the booking
// RPCs raise `staff_unavailable` / `not found` for a service with no eligible
// active member, so listing one is an invitation to a dead end. Every public
// entry point (/book/[handle], /book/[handle]/[staffSlug], /embed/[handle])
// runs its service list through here.
//
// Pure and its own module on purpose: the pages are server components and
// public.ts is `server-only`, so a decision living in either could not be
// unit-tested — same reasoning as booking-errors.ts.

import type { Entitlements } from "@/lib/billing/entitlements";

export function filterBookableServices<T extends { id: string }>(
  services: T[],
  // serviceId → linked staff ids, UNFILTERED by staff.active
  // (listServiceStaffMap's documented contract).
  serviceStaffIds: Record<string, string[]>,
  // The org's ACTIVE roster — the intersection with it is the whole point.
  activeStaff: readonly { id: string }[],
  // Narrow further to one person (their own booking link, or an embed pinned
  // with `?staff=`): keep only what they personally offer.
  onlyStaffId?: string | null,
): T[] {
  const active = new Set(activeStaff.map((s) => s.id));
  return services.filter((s) => {
    const eligible = serviceStaffIds[s.id] ?? [];
    if (onlyStaffId) return active.has(onlyStaffId) && eligible.includes(onlyStaffId);
    return eligible.some((id) => active.has(id));
  });
}

/** Admin-side twin of filterBookableServices for rows that carry their own
    `staffIds` (ServiceRow) and a full roster with `active`: the services a
    Copy-link / Links & embeds row may point at — active, and linked to at
    least one active person. Plan caps (public service limits) are NOT
    applied here; a capped service's link degrades to the org flow. */
export function bookableAdminServices<T extends { id: string; active: boolean; staffIds: string[] }>(
  services: T[],
  staff: readonly { id: string; active: boolean }[],
): T[] {
  const map = Object.fromEntries(services.map((s) => [s.id, s.staffIds]));
  return filterBookableServices(services.filter((s) => s.active), map, staff.filter((s) => s.active));
}

// Plan limits shape the PUBLIC offering, never the data (spec §4.2): the
// first `bookableStaff` active people by sort order stay bookable, services
// narrow to what those people offer, then cap at `publicServices`. Order in
// = order out — callers pass lists already sorted by sort_order.
export function limitPublicOffering<S extends { id: string }, T extends { id: string }>(
  services: S[],
  staff: T[],
  serviceStaffIds: Record<string, string[]>,
  ent: Entitlements,
): { services: S[]; staff: T[] } {
  const bookableStaff = staff.slice(0, ent.bookableStaff);
  const offered = filterBookableServices(services, serviceStaffIds, bookableStaff);
  const capped = ent.publicServices === null ? offered : offered.slice(0, ent.publicServices);
  return { services: capped, staff: bookableStaff };
}

// What `create_booking` is told about staff. Two fields (0052):
//   staffId    — a named person (the RPC checks them strictly), or null for
//                "let the DB pick";
//   candidates — when staffId is null, the people the DB may pick FROM: the
//                bookable roster members the engine found free at the
//                instant (buffers, max/day and plan limits already applied).
//                The DB's pick_staff_for_slot ranks least-loaded INSIDE this
//                set, so it can never land on someone the engine excluded
//                (before 0052 it ranked over the raw roster and could).
// Cases, in order:
//   1. the client named a person   → that person;
//   2. exactly one bookable person → name them, same strict check;
//   3. "anyone" across several     → null + the free bookable set (falling
//      back to the whole bookable roster only if the caller passed nobody as
//      free, which the pre-flight union normally rules out).
export function chooseStaffForBooking(args: {
  staffId: string | "any";
  /** The plan's public roster, in sort order. */
  bookableIds: string[];
  /** Every ACTIVE member linked to the service — what the DB picker ranks over. */
  eligibleStaffIds: string[];
  /** Bookable staff free at the requested instant, in sort order. */
  freeStaffIdsAtSlot: string[];
}): { staffId: string | null; candidates: string[] | null } {
  const { staffId, bookableIds, freeStaffIdsAtSlot } = args;
  if (staffId !== "any") return { staffId, candidates: null };
  if (bookableIds.length === 1) return { staffId: bookableIds[0], candidates: null };
  const free = freeStaffIdsAtSlot.filter((id) => bookableIds.includes(id));
  return { staffId: null, candidates: free.length > 0 ? free : bookableIds };
}
