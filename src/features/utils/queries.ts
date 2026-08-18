import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
    orgs and "show me what's here" is the common first click. */
export async function searchOrgs(q: string): Promise<OrgSummary[]> {
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
