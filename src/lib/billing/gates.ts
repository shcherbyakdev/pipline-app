import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS, plansEnforced, type Flags } from "@/lib/flags";
import { getOrgFlags } from "@/lib/flags/resolve";
import { effectiveMode, type OrgMode } from "@/features/orgs/mode";
import { getEntitlements } from "./queries";
import { canAddResource, canAddService, countResources, type Entitlements, type ResourceUsage } from "./entitlements";
import { getTranslations } from "next-intl/server";
import { upgradeHref } from "./upgrade-path";
import { refusalCopy, type GateRefusal, type UpgradeDoor, type UpgradeHint } from "./refusal";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// The pure gates return the refusal as data (refusal.ts); assertCanAdd*
// turns it into copy in the admin's language, or null when allowed.

/** Which way out the refusal names — upgradeHref's answer as a copy key, so
    the sentence and the link every surface renders can never disagree. */
export function upgradeHint(flags: Pick<Flags, "billing" | "premium_waitlist">, ent: Pick<Entitlements, "plan">): UpgradeHint {
  const href = upgradeHref(flags, ent.plan);
  return href === "/billing" ? "billing" : href === "/waitlist" ? "waitlist" : "none";
}

/** H5b: people and units share one budget (spec ruling 4/5). The cap comes
    from the entitlements, so a Team org at 5 of 5 is told it has 5. */
export function resourceGate(usage: ResourceUsage, mode: OrgMode, ent: Entitlements, how: UpgradeHint = "billing"): GateRefusal | null {
  return canAddResource(countResources(usage, mode), ent) ? null : { reason: "resources", max: ent.bookableResources, how };
}
export function serviceGate(serviceCount: number, ent: Entitlements, how: UpgradeHint = "billing"): GateRefusal | null {
  return canAddService(serviceCount, ent) ? null : { reason: "services", how };
}
const FAILED: GateRefusal = { reason: "failed", how: "none" };

// The lookup + evaluation, no flag check. A failed entitlements/count read
// must refuse conservatively (spec §7.10) rather than crash the Server
// Action, so the lookup is wrapped here rather than left to throw — callers
// (assertCanAdd*, and tests) always get back a refusal|null, never a
// rejection. `flags` is passed in (the callers already resolved it for the
// enforcement check) so the rentals kill-switch can stop units from
// counting and the refusal can name the right way out (upgradeHint).
export async function evaluateResourceGate(
  orgId: string,
  client: SupabaseClient,
  flags: Pick<Flags, "rentals" | "billing" | "premium_waitlist">,
): Promise<GateRefusal | null> {
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
    return resourceGate({ activeStaff: staffRes.count ?? 0, activeUnits: unitRes.count ?? 0 }, mode, ent, upgradeHint(flags, ent));
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return FAILED;
  }
}

export async function evaluateServiceGate(
  orgId: string,
  client: SupabaseClient,
  flags: Pick<Flags, "billing" | "premium_waitlist">,
): Promise<GateRefusal | null> {
  try {
    const [ent, { count, error }] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("services").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    if (error) throw error;
    return serviceGate(count ?? 0, ent, upgradeHint(flags, ent));
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return FAILED;
  }
}

/* The public entry points. Resolve the org's flags through the same RLS
   client the action holds (org_feature_flags has a member SELECT policy);
   a failed flag read behaves as the environment default rather than block a
   provider from adding a unit because a flag table hiccuped. */
/** A refused write's result: the sentence in the admin's language and the
    door out (null when no plan can help). Actions return it as-is. */
export type Refused = { ok: false; error: string; upgrade: UpgradeDoor | null };

async function refused(refusal: GateRefusal | null): Promise<Refused | null> {
  if (!refusal) return null;
  return { ok: false, ...refusalCopy(await getTranslations("errors"), refusal) };
}

export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<Refused | null> {
  const flags = await orgFlags(orgId, client);
  if (!plansEnforced(flags)) return null;
  return refused(await evaluateResourceGate(orgId, client, flags));
}

/** H5b: a new or reactivated unit spends the same budget a person does. */
export async function assertCanAddUnit(orgId: string, client: SupabaseClient): Promise<Refused | null> {
  const flags = await orgFlags(orgId, client);
  if (!plansEnforced(flags)) return null;
  return refused(await evaluateResourceGate(orgId, client, flags));
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<Refused | null> {
  const flags = await orgFlags(orgId, client);
  if (!plansEnforced(flags)) return null;
  return refused(await evaluateServiceGate(orgId, client, flags));
}

async function orgFlags(orgId: string, client: SupabaseClient): Promise<Flags> {
  try {
    return await getOrgFlags(orgId, client);
  } catch (error) {
    console.error("[billing] flag read failed in gate (using defaults):", error);
    return { ...FLAG_DEFAULTS };
  }
}
