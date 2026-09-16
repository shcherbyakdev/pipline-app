import { filterBookableServices } from "@/lib/booking/bookable";
import { narrowCatalogue } from "@/features/booking-page/narrow-catalogue";
import type { LinkTarget } from "@/lib/booking/url";

/* What the preview widget shows for one snippet target — the rule of
   app/embed/[handle]/page.tsx, pure so the page and the preview cannot
   drift: a pinned person narrows the list to what they offer and drops
   spaces; a person who offers nothing drops the lock (the embed degrades,
   never breaks); ticked services or spaces narrow to those, and a single
   one is a first-render request (narrowCatalogue, the public pages' own
   helper). The catalogue is the preview catalogue (canned stand-ins
   included), so a person whose org has no real services yet degrades the
   same way. */
export function previewFor<S extends { id: string }, O extends { id: string }, P extends { id: string; slug: string }>(
  target: LinkTarget,
  input: { services: S[]; offerings: O[]; staff: readonly P[]; serviceStaffIds: Record<string, string[]> },
): {
  services: S[];
  offerings: O[];
  lockedStaff: P | null;
  requestedService: { id: string; key: number } | null;
  requestedOffering: { id: string; key: number } | null;
} {
  const none = { lockedStaff: null, requestedService: null, requestedOffering: null };
  if (target && "staff" in target) {
    const person = input.staff.find((p) => p.slug === target.staff) ?? null;
    const theirs = person ? filterBookableServices(input.services, input.serviceStaffIds, input.staff, person.id) : [];
    if (person && theirs.length > 0) return { ...none, services: theirs, offerings: [], lockedStaff: person };
    return { ...none, services: input.services, offerings: input.offerings };
  }
  const shown = narrowCatalogue(input, {
    services: target && "services" in target ? target.services : [],
    spaces: target && "spaces" in target ? target.spaces : [],
  });
  return {
    ...none,
    services: shown.services,
    offerings: shown.offerings,
    requestedService: shown.initialServiceId ? { id: shown.initialServiceId, key: 1 } : null,
    requestedOffering: shown.initialOfferingId ? { id: shown.initialOfferingId, key: 1 } : null,
  };
}
