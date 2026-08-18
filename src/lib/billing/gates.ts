import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_ENABLED } from "@/lib/flags";
import { getEntitlements } from "./queries";
import { canAddService, canAddStaff, type Entitlements } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitStaffError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.
export function staffGateMessage(activeCount: number, ent: Entitlements): string | null {
  // The cap comes from the entitlements, so a Team org at 5 of 5 is told it
  // has 5 — not that team members are a Team-plan feature it already pays for.
  return canAddStaff(activeCount, ent) ? null : planLimitStaffError(ent.bookableStaff);
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
// needing BILLING_ENABLED true.
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

export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  return evaluateStaffGate(orgId, client);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  return evaluateServiceGate(orgId, client);
}
