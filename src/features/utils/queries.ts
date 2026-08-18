import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { orgSearchInput } from "./schema";
import { readFakeRow } from "@/features/billing/dev/queries";
import type { FakeRow } from "@/lib/billing/fake-emulator";
import { getPlanOverrideDetails } from "@/lib/billing/queries";
import { activeOverrideRow, type PlanOverrideDetails } from "@/lib/billing/overrides";
import { entitlementsFor } from "@/lib/billing/entitlements";
import type { PlanId } from "@/lib/billing/plans";

/* Owner-only reads. Every function here takes the ADMIN client on purpose:
   the point of /utils is to look at ANY org, which the RLS client cannot do.
   Callers have already passed requireInternal(). */

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  handle: string | null;
  createdAt: string;
};

const ORG_COLS = "id, name, slug, handle, created_at";

/** Up to 20 orgs whose name, slug or handle contains `q` (case-insensitive),
    newest first. Empty `q` lists the 20 newest — a fresh environment has few
    orgs and "show me what's here" is the common first click. `q` is run
    through `orgSearchInput` HERE, at the query boundary, so it is stripped
    of `%`, `,` and `(` before it reaches a PostgREST `ilike`/`.or()`
    pattern no matter what the caller passed in — `.or()` splits on
    top-level commas and groups on parentheses, so an unsanitized org name
    like "Joe's Salon (Downtown)" would otherwise corrupt the filter. */
export async function searchOrgs(raw: string): Promise<OrgSummary[]> {
  const { q } = orgSearchInput.parse({ q: raw });
  const admin = createAdminClient();
  let query = admin.from("orgs").select(ORG_COLS).order("created_at", { ascending: false }).limit(20);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern},handle.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    handle: o.handle,
    createdAt: o.created_at,
  }));
}

/** One org by id, or null. */
export async function getOrgSummary(orgId: string): Promise<OrgSummary | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("orgs").select(ORG_COLS).eq("id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, name: data.name, slug: data.slug, handle: data.handle, createdAt: data.created_at };
}

export type FlagOverrideRow = { flag: string; enabled: boolean; updatedBy: string; updatedAt: string };

export type OrgAdminView = {
  org: OrgSummary;
  /** The provider row incl. provider ids (readFakeRow's shape — the only
      other place that shows them is the dev portal). */
  subscription: FakeRow | null;
  /** The WHOLE override row, note and grantor included — the admin client is
      the only one privileged to read those columns (0046). */
  override: PlanOverrideDetails | null;
  effectivePlan: PlanId;
  flags: FlagOverrideRow[];
};

/** Everything /utils shows about one org, in one read. Null when the org
    does not exist. */
export async function readOrgAdminView(orgId: string, now = new Date()): Promise<OrgAdminView | null> {
  const admin = createAdminClient();
  const org = await getOrgSummary(orgId);
  if (!org) return null;
  const [subscription, override, flagRes] = await Promise.all([
    readFakeRow(admin, orgId),
    getPlanOverrideDetails(orgId, admin),
    admin.from("org_feature_flags").select("flag, enabled, updated_by, updated_at").eq("org_id", orgId),
  ]);
  if (flagRes.error) throw flagRes.error;
  const effective = activeOverrideRow(override, now) ?? (subscription ? { ...subscription } : null);
  return {
    org,
    subscription,
    override,
    effectivePlan: entitlementsFor(effective, now).plan,
    flags: (flagRes.data ?? []).map((r) => ({ flag: r.flag, enabled: r.enabled, updatedBy: r.updated_by, updatedAt: r.updated_at })),
  };
}
