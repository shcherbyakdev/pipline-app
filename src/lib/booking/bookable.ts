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

// Who `create_booking` should be told to assign — null means "let the DB
// auto-assign" (pick_staff_for_slot). The DB picker ranks over EVERY active
// member linked to the service, so it knows nothing about plan limits: handing
// it null on a plan-restricted org could assign someone the public page does
// not even list. Three cases, in order:
//   1. the client named a person   → that person (the RPC checks them strictly);
//   2. exactly one bookable person → name them, same strict check;
//   3. "anyone" across several     → null ONLY while the bookable set covers
//      the service's whole eligible roster; when it is a strict subset, name
//      the first bookable person free at that instant instead (the pre-flight
//      union already knows who that is, in sort order).
// The bookableIds fallback in case 3 cannot normally fire — the caller has
// already asserted the instant is in the union — but naming someone bookable
// beats handing the DB a free choice it would make wrongly.
export function chooseStaffForBooking(args: {
  staffId: string | "any";
  /** The plan's public roster, in sort order. */
  bookableIds: string[];
  /** Every ACTIVE member linked to the service — what the DB picker ranks over. */
  eligibleStaffIds: string[];
  /** Bookable staff free at the requested instant, in sort order. */
  freeStaffIdsAtSlot: string[];
}): string | null {
  const { staffId, bookableIds, eligibleStaffIds, freeStaffIdsAtSlot } = args;
  if (staffId !== "any") return staffId;
  if (bookableIds.length === 1) return bookableIds[0];
  const restricted = eligibleStaffIds.some((id) => !bookableIds.includes(id));
  if (!restricted) return null;
  return freeStaffIdsAtSlot[0] ?? bookableIds[0];
}
