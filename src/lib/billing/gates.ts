import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS } from "@/lib/flags";
import { getOrgFlags } from "@/lib/flags/resolve";
import { getEntitlements } from "./queries";
import { canAddResource, canAddService, type Entitlements } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.
export function staffGateMessage(activeCount: number, ent: Entitlements): string | null {
  // The cap comes from the entitlements, so a Team org at 5 of 5 is told it
  // has 5 — not that team members are a Team-plan feature it already pays for.
  return canAddResource(activeCount, ent) ? null : planLimitResourceError(ent.bookableResources);
}
export function serviceGateMessage(serviceCount: number, ent: Entitlements): string | null {
  return canAddService(serviceCount, ent) ? null : PLAN_LIMIT_SERVICES_ERROR;
}

// The lookup + evaluation, no flag check. A failed entitlements/count read
// must refuse conservatively (spec §7.10) rather than crash the Server
// Action, so the lookup is wrapped here rather than left to throw — callers
// (assertCanAdd*, and tests) always get back a string|null, never a
// rejection. Exported (rather than inlined in assertCanAdd*) so tests can
// exercise both the success and failure paths with a stub client, without
// needing the org's `billing` flag on.
export async function evaluateStaffGate(orgId: string, client: SupabaseClient): Promise<string | null> {
  try {
    const [ent, { count, error }] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
    ]);
    if (error) throw error;
    return staffGateMessage(count ?? 0, ent);
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

/* The public entry points. Resolve the org's flag through the same RLS
   client the action holds (org_feature_flags has a member SELECT policy);
   a failed FLAG read refuses conservatively like a failed entitlement read
   would (spec §7.10) — evaluate* already wraps its own lookups. */
export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!(await billingOn(orgId, client))) return null;
  return evaluateStaffGate(orgId, client);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!(await billingOn(orgId, client))) return null;
  return evaluateServiceGate(orgId, client);
}

async function billingOn(orgId: string, client: SupabaseClient): Promise<boolean> {
  try {
    return (await getOrgFlags(orgId, client)).billing;
  } catch (error) {
    // Unknown flag state → behave as the environment default rather than
    // block a provider from adding a service because a flag table hiccuped.
    console.error("[billing] flag read failed in gate (using default):", error);
    return FLAG_DEFAULTS.billing;
  }
}
