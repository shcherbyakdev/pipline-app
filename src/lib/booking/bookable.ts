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
