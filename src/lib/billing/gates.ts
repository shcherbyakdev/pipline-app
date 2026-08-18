import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_ENABLED } from "@/lib/flags";
import { getEntitlements } from "./queries";
import { canAddService, canAddStaff, type Entitlements } from "./entitlements";
import { PLAN_LIMIT_SERVICES_ERROR, PLAN_LIMIT_STAFF_ERROR } from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.
export function staffGateMessage(activeCount: number, ent: Entitlements): string | null {
  return canAddStaff(activeCount, ent) ? null : PLAN_LIMIT_STAFF_ERROR;
}
export function serviceGateMessage(serviceCount: number, ent: Entitlements): string | null {
  return canAddService(serviceCount, ent) ? null : PLAN_LIMIT_SERVICES_ERROR;
}

export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  const [ent, { count, error }] = await Promise.all([
    getEntitlements(orgId, client),
    client.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
  ]);
  if (error) throw error;
  return staffGateMessage(count ?? 0, ent);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  const [ent, { count, error }] = await Promise.all([
    getEntitlements(orgId, client),
    client.from("services").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  if (error) throw error;
  return serviceGateMessage(count ?? 0, ent);
}
