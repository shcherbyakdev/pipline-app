import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PAGE } from "./defaults";
import { parsePageDocument, type PageDocument } from "./schema";

/** The published document for a public page, or DEFAULT_PAGE when there is
    none / it fails to parse (logged). Admin client: the public surface stays
    off the anon grant surface (getBookingOrg precedent). Memoised per
    request — the page and generateMetadata both read it. */
export const getPublishedPage = cache(async (orgId: string): Promise<PageDocument> => {
  const admin = createAdminClient();
  const { data, error } = await admin.from("booking_pages").select("published").eq("org_id", orgId).maybeSingle();
  if (error) {
    console.error("[booking-page] published read failed:", error.message);
    return DEFAULT_PAGE;
  }
  if (!data?.published) return DEFAULT_PAGE;
  const doc = parsePageDocument(data.published, orgId);
  if (!doc) {
    console.error(`[booking-page] published document for org ${orgId} failed to parse — rendering the default page`);
    return DEFAULT_PAGE;
  }
  return doc;
});

export type PageDraftState = { draft: PageDocument; published: PageDocument | null; publishedAt: string | null };

/** RLS-scoped read for the studio. An unparseable stored draft falls back to
    the published page, then to the default — the same doctrine as above. */
export async function getPageDraftState(orgId: string): Promise<PageDraftState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pages")
    .select("draft, published, published_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { draft: DEFAULT_PAGE, published: null, publishedAt: null };
  const published = data.published ? parsePageDocument(data.published, orgId) : null;
  return {
    draft: parsePageDocument(data.draft, orgId) ?? published ?? DEFAULT_PAGE,
    published,
    publishedAt: data.published_at,
  };
}
