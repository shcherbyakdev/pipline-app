import "server-only";
import { cache } from "react";
import {
  listPublicServices,
  listPublicStaff,
  listServiceStaffMap,
  type PublicService,
  type PublicStaff,
} from "./public";
import { limitPublicOffering } from "./bookable";
import { getEntitlementsAdminStrict } from "@/lib/billing/queries";
import { type Entitlements } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";
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

// Team's own limits with the seat cap lifted: every paid feature on, no
// service cap, no reminder quota. Used while billing is off, and as the
// fail-open answer below — so both paths agree on every field, including the
// flags no one reads yet.
const UNLIMITED: Entitlements = {
  ...PLANS.team.limits,
  plan: "team",
  bookableStaff: Number.MAX_SAFE_INTEGER,
};

async function loadEntitlements(orgId: string): Promise<Entitlements> {
  if (!BILLING_ENABLED) return UNLIMITED;
  try {
    return await getEntitlementsAdminStrict(orgId);
  } catch (error) {
    // Spec §7.10, amended: a failed billing read degrades to Free everywhere
    // EXCEPT here. Free limits would hide a paying org's staff and services
    // from its own booking page — an outage must never shrink what a customer
    // sells, so the offering fails open and the badge/quota paths (which
    // degrade to Free) carry the cost instead.
    console.error("[billing] entitlements read failed — offering fails open:", error);
    return UNLIMITED;
  }
}

// Per-request memoised: the pages render it once, but getSlots/createBooking
// each reach it through loadSlotContext, and a single request must not repeat
// these three reads.
export const loadPublicOffering = cache(async (orgId: string): Promise<PublicOffering> => {
  const [allServices, allStaff, serviceStaffIds, entitlements] = await Promise.all([
    listPublicServices(orgId),
    listPublicStaff(orgId),
    listServiceStaffMap(orgId),
    loadEntitlements(orgId),
  ]);
  // limitPublicOffering already drops services nobody bookable offers — the
  // roster narrowing and the active-staff filter are the same pass.
  const limited = limitPublicOffering(allServices, allStaff, serviceStaffIds, entitlements);
  return { services: limited.services, staff: limited.staff, serviceStaffIds, entitlements };
});
