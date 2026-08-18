import "server-only";
import {
  listPublicServices,
  listPublicStaff,
  listServiceStaffMap,
  type PublicService,
  type PublicStaff,
} from "./public";
import { filterBookableServices, limitPublicOffering } from "./bookable";
import { getEntitlementsAdmin } from "@/lib/billing/queries";
import { entitlementsFor, type Entitlements } from "@/lib/billing/entitlements";
import { BILLING_ENABLED } from "@/lib/flags";

// The one loader every public entry point uses (/book/[handle], its staff
// pages, /embed, and the public server actions): the org's active roster and
// services, narrowed to what the org's plan may offer. While billing is off
// this is exactly today's behaviour (Team-shaped entitlements = no narrowing).
export type PublicOffering = {
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds: Record<string, string[]>;
  entitlements: Entitlements;
};

// Every limit lifted, so the flag-off path can share one code path with the
// flag-on one and still behave byte-for-byte as it does today: `hideBadge`
// keeps the org's existing embed toggle authoritative, and the null reminder
// quota keeps every booking's reminder flowing.
const UNLIMITED: Entitlements = {
  ...entitlementsFor(null, new Date()),
  plan: "team",
  bookableStaff: Number.MAX_SAFE_INTEGER,
  publicServices: null,
  reminderBookingsPerMonth: null,
  hideBadge: true,
};

export async function loadPublicOffering(orgId: string): Promise<PublicOffering> {
  const [allServices, allStaff, serviceStaffIds, entitlements] = await Promise.all([
    listPublicServices(orgId),
    listPublicStaff(orgId),
    listServiceStaffMap(orgId),
    BILLING_ENABLED ? getEntitlementsAdmin(orgId) : Promise.resolve(UNLIMITED),
  ]);
  const limited = limitPublicOffering(allServices, allStaff, serviceStaffIds, entitlements);
  return {
    services: filterBookableServices(limited.services, serviceStaffIds, limited.staff),
    staff: limited.staff,
    serviceStaffIds,
    entitlements,
  };
}
