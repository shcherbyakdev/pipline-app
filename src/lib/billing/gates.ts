import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS, type Flags } from "@/lib/flags";
import { getOrgFlags } from "@/lib/flags/resolve";
import { effectiveMode, type OrgMode } from "@/features/orgs/mode";
import { getEntitlements } from "./queries";
import { canAddResource, canAddService, countResources, type Entitlements, type ResourceUsage } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.

/** H5b: people and units share one budget (spec ruling 4/5). The cap comes
    from the entitlements, so a Team org at 5 of 5 is told it has 5. */
export function resourceGateMessage(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): string | null {
  return canAddResource(countResources(usage, mode), ent) ? null : planLimitResourceError(ent.bookableResources);
}
export function serviceGateMessage(serviceCount: number, ent: Entitlements): string | null {
  return canAddService(serviceCount, ent) ? null : PLAN_LIMIT_SERVICES_ERROR;
}

// The lookup + evaluation, no flag check. A failed entitlements/count read
// must refuse conservatively (spec §7.10) rather than crash the Server
// Action, so the lookup is wrapped here rather than left to throw — callers
// (assertCanAdd*, and tests) always get back a string|null, never a
// rejection. `flags` is passed in (the callers already resolved it for the
// billing check) so the rentals kill-switch can stop units from counting.
export async function evaluateResourceGate(
  orgId: string,
  client: SupabaseClient,
  flags: Pick<Flags, "rentals">,
): Promise<string | null> {
  try {
    const [ent, orgRow, staffRes, unitRes] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("orgs").select("offers_appointments, offers_rentals").eq("id", orgId).maybeSingle(),
      client.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
      client.from("rental_units").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
    ]);
    const failed = orgRow.error ?? staffRes.error ?? unitRes.error;
    if (failed) throw failed;
    if (!orgRow.data) throw new Error("org row missing");
    const mode = effectiveMode(flags, {
      offersAppointments: orgRow.data.offers_appointments,
      offersRentals: orgRow.data.offers_rentals,
    });
    return resourceGateMessage({ activeStaff: staffRes.count ?? 0, activeUnits: unitRes.count ?? 0 }, mode, ent);
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return GENERIC_WRITE_ERROR;
  }
}

export async function evaluateServiceGate(orgId: string, client: SupabaseClient): Promise<string | null> {
  try {
    const [ent, { count, error }] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("services").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    if (error) throw error;
    return serviceGateMessage(count ?? 0, ent);
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return GENERIC_WRITE_ERROR;
  }
}

/* The public entry points. Resolve the org's flags through the same RLS
   client the action holds (org_feature_flags has a member SELECT policy);
   a failed flag read behaves as the environment default rather than block a
   provider from adding a unit because a flag table hiccuped. */
export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  const flags = await orgFlags(orgId, client);
  if (!flags.billing) return null;
  return evaluateResourceGate(orgId, client, flags);
}

/** H5b: a new or reactivated unit spends the same budget a person does. */
export async function assertCanAddUnit(orgId: string, client: SupabaseClient): Promise<string | null> {
  const flags = await orgFlags(orgId, client);
  if (!flags.billing) return null;
  return evaluateResourceGate(orgId, client, flags);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!(await orgFlags(orgId, client)).billing) return null;
  return evaluateServiceGate(orgId, client);
}

async function orgFlags(orgId: string, client: SupabaseClient): Promise<Flags> {
  try {
    return await getOrgFlags(orgId, client);
  } catch (error) {
    console.error("[billing] flag read failed in gate (using defaults):", error);
    return { ...FLAG_DEFAULTS };
  }
}
