import "server-only";
import { cache } from "react";
import {
  getOrgModeAdmin,
  listPublicServices,
  listPublicStaff,
  listPublicUnitsForOrg,
  listServiceStaffMap,
  type PublicService,
  type PublicStaff,
} from "./public";
import { limitPublicOffering, limitPublicResources } from "./bookable";
import { getEntitlementsAdminStrict } from "@/lib/billing/queries";
import { type Entitlements } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";
import { plansEnforced } from "@/lib/flags";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { effectiveMode } from "@/features/orgs/mode";

// The one loader every public entry point uses (/book/[handle], its staff
// pages, /embed, and the public server actions): the org's active roster and
// services, narrowed to what the org's plan may offer. While billing is off
// this is exactly today's behaviour (Team-shaped entitlements = no narrowing).
//
// Named for what it IS — an appointments roster after the plan limits — so it
// never reads as a twin of `PublicOffering` in ./public, which is the rentals
// product (a rentable thing with units and a date window).
export type PlanLimitedOffering = {
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds: Record<string, string[]>;
  entitlements: Entitlements;
  /** H5b: the units (and the spaces owning them) the plan lets the public
      page book; null = no cap — billing off or the fail-open path, exactly
      today's behaviour. The rental actions filter the engine's units to this
      set; listPublicCatalog lists a space only if it owns an allowed unit. */
  allowedUnitIds: ReadonlySet<string> | null;
  allowedSpaceIds: ReadonlySet<string> | null;
};

// Team's own limits with the resource cap lifted: every paid feature on, no
// service cap, no reminder quota. Used while billing is off, and as the
// fail-open answer below — so both paths agree on every field, including the
// flags no one reads yet.
const UNLIMITED: Entitlements = {
  ...PLANS.team.limits,
  plan: "team",
  bookableResources: Number.MAX_SAFE_INTEGER,
};

// null = no cap applies (limits not enforced — plansEnforced — or the read
// failed and the offering fails open — see loadPublicResources).
async function loadEntitlements(orgId: string): Promise<Entitlements | null> {
  if (!plansEnforced(await getOrgFlagsAdmin(orgId))) return null;
  try {
    return await getEntitlementsAdminStrict(orgId);
  } catch (error) {
    // Spec §7.10, amended: a failed billing read degrades to Free everywhere
    // EXCEPT here. Free limits would hide a paying org's staff and services
    // from its own booking page — an outage must never shrink what a customer
    // sells, so the offering fails open and the badge/quota paths (which
    // degrade to Free) carry the cost instead.
    console.error("[billing] entitlements read failed — offering fails open:", error);
    return null;
  }
}

export type PublicResources = {
  staff: PublicStaff[];
  allowedUnitIds: ReadonlySet<string>;
  allowedSpaceIds: ReadonlySet<string>;
  entitlements: Entitlements;
};

// H5b: the plan's people/unit budget applied (spec §2.2). null = no cap.
// Per-request memoised; the rental actions call it directly (zero extra
// reads while billing is off — the flag read is memoised too), the offering
// loader below folds it in. Fails OPEN like loadEntitlements: a failed mode
// or unit read must not hide a paying org's rooms.
export const loadPublicResources = cache(async (orgId: string): Promise<PublicResources | null> => {
  const ent = await loadEntitlements(orgId);
  if (!ent) return null;
  try {
    const [staff, mode, units, flags] = await Promise.all([
      listPublicStaff(orgId),
      getOrgModeAdmin(orgId),
      listPublicUnitsForOrg(orgId),
      getOrgFlagsAdmin(orgId),
    ]);
    if (!mode) throw new Error("org row missing");
    const kept = limitPublicResources(staff, units, effectiveMode(flags, mode), ent);
    return {
      staff: kept.staff,
      allowedUnitIds: new Set(kept.units.map((u) => u.id)),
      allowedSpaceIds: new Set(kept.units.map((u) => u.offeringId)),
      entitlements: ent,
    };
  } catch (error) {
    console.error("[billing] resource read failed — offering fails open:", error);
    return null;
  }
});

// Per-request memoised: the pages render it once, but getSlots/createBooking
// each reach it through loadSlotContext, and a single request must not repeat
// these reads.
export const loadPublicOffering = cache(async (orgId: string): Promise<PlanLimitedOffering> => {
  const [allServices, allStaff, serviceStaffIds, resources] = await Promise.all([
    listPublicServices(orgId),
    listPublicStaff(orgId),
    listServiceStaffMap(orgId),
    loadPublicResources(orgId),
  ]);
  const entitlements = resources?.entitlements ?? UNLIMITED;
  // With a cap, the roster is what limitPublicResources kept (people first);
  // limitPublicOffering's own slice is then a no-op and still drops services
  // nobody bookable offers — the roster narrowing and the active-staff filter
  // are the same pass.
  const limited = limitPublicOffering(allServices, resources?.staff ?? allStaff, serviceStaffIds, entitlements);
  return {
    services: limited.services,
    staff: limited.staff,
    serviceStaffIds,
    entitlements,
    allowedUnitIds: resources?.allowedUnitIds ?? null,
    allowedSpaceIds: resources?.allowedSpaceIds ?? null,
  };
});
