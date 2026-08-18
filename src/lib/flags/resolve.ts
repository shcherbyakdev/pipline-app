import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FLAG_DEFAULTS, FLAG_KEYS, type FlagKey, type Flags } from "./index";

/* Per-org flag resolution (spec 2026-08-18-internal-utils §3.5): the org's
   org_feature_flags rows merged over FLAG_DEFAULTS. Three entry points for
   three kinds of caller; all return a full `Flags`. */

export function mergeFlags(rows: ReadonlyArray<{ flag: string; enabled: boolean }>): Flags {
  const flags: Flags = { ...FLAG_DEFAULTS };
  for (const row of rows) {
    if ((FLAG_KEYS as readonly string[]).includes(row.flag)) flags[row.flag as FlagKey] = row.enabled;
  }
  return flags;
}

/** Works with the RLS client (dashboard, actions: the member SELECT policy
    scopes rows to their org) and the admin client. Throws on a read error. */
export async function getOrgFlags(orgId: string, client: SupabaseClient): Promise<Flags> {
  const { data, error } = await client.from("org_feature_flags").select("flag, enabled").eq("org_id", orgId);
  if (error) throw error;
  return mergeFlags(data ?? []);
}

/** Dashboard pages, layouts and server actions: the caller's own org through
    the RLS client. Per-request memoised, so the layout and the page reading
    the same org cost one query. Throws — the dashboard already throws when
    the org read fails, and a page rendered against the wrong flags is worse
    than an error page. */
export const getDashboardFlags = cache(async (orgId: string): Promise<Flags> => getOrgFlags(orgId, await createClient()));

/** Public/drain paths (org resolved by handle or booking): admin client,
    per-request memoised, DEGRADES TO DEFAULTS on failure — a broken flag read
    must never break a booking page (getEntitlementsAdmin stance). */
export const getOrgFlagsAdmin = cache(async (orgId: string): Promise<Flags> => {
  try {
    return await getOrgFlags(orgId, createAdminClient());
  } catch (error) {
    console.error("[flags] read failed (using defaults):", error);
    return { ...FLAG_DEFAULTS };
  }
});
