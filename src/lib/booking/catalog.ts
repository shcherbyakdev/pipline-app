import "server-only";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { listPublicOfferings, type BookingOrg, type PublicOffering } from "@/lib/booking/public";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";

/* The one gated read for the public catalogue (H1): a channel the org has
   turned off (Settings → Business) — or a rentals feature flag turned off —
   is simply absent, however many active rows it still has. /[handle],
   /[handle]/[staffSlug] and /embed/[handle] all come through here so they
   can't disagree. The create RPCs re-check the mode in SQL (0054) as the
   hard gate. */
export async function listPublicCatalog(org: BookingOrg): Promise<{
  offering: Awaited<ReturnType<typeof loadPublicOffering>>;
  offerings: PublicOffering[];
}> {
  const [offering, allOfferings] = await Promise.all([
    loadPublicOffering(org.orgId),
    org.offersRentals
      ? getOrgFlagsAdmin(org.orgId).then((f) => (f.rentals ? listPublicOfferings(org.orgId) : []))
      : Promise.resolve([]),
  ]);
  // H5b: a space whose every unit the plan hides is not listed (null = no
  // cap). A ?space= deep link to it degrades to the org flow through the
  // same resolver an inactive space uses.
  const allowed = offering.allowedSpaceIds;
  const offerings = allowed === null ? allOfferings : allOfferings.filter((o) => allowed.has(o.id));
  if (!org.offersAppointments) {
    // A rentals-only page shows no services and no people. Entitlements and
    // the rest of the bundle stay intact for the badge / plan logic.
    return { offering: { ...offering, services: [], staff: [], serviceStaffIds: {} }, offerings };
  }
  return { offering, offerings };
}
