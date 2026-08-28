import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getEntitlements } from "@/lib/billing/queries";
import type { PlanLimits } from "@/lib/billing/plans";
import { DEFAULT_PAGE } from "./defaults";
import { parsePageDocument, type PageDocument } from "./schema";
import { parsePageChannel, type PageChannel } from "./channel";

/** One channel's published document for a public page, or DEFAULT_PAGE when
    there is none / it fails to parse (logged). Admin client: the public
    surface stays off the anon grant surface (getBookingOrg precedent).
    Memoised per request — the page and generateMetadata both read it. */
export const getPublishedPage = cache(async (orgId: string, channel: PageChannel): Promise<PageDocument> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_pages")
    .select("published")
    .eq("org_id", orgId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) {
    console.error("[booking-page] published read failed:", error.message);
    return DEFAULT_PAGE;
  }
  if (!data?.published) return DEFAULT_PAGE;
  const doc = parsePageDocument(data.published, orgId);
  if (!doc) {
    console.error(`[booking-page] published ${channel} document for org ${orgId} failed to parse — rendering the default page`);
    return DEFAULT_PAGE;
  }
  return doc;
});

export type PageDraftState = { draft: PageDocument; published: PageDocument | null; publishedAt: string | null };

type PageRow = { draft: unknown; published: unknown; published_at: string | null };

/** An unparseable stored draft falls back to the published page, then to
    the default — the same doctrine as getPublishedPage. */
function toDraftState(row: PageRow, orgId: string): PageDraftState {
  const published = row.published ? parsePageDocument(row.published, orgId) : null;
  return {
    draft: parsePageDocument(row.draft, orgId) ?? published ?? DEFAULT_PAGE,
    published,
    publishedAt: row.published_at,
  };
}

export const EMPTY_PAGE_STATE: PageDraftState = { draft: DEFAULT_PAGE, published: null, publishedAt: null };

/** Every page of the org in one read, keyed by channel; a channel with no
    row is absent. The builder asks it "is anything published?" and the
    welcome checklist reads the front door's entry. */
export async function getPageStates(orgId: string): Promise<Partial<Record<PageChannel, PageDraftState>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pages")
    .select("channel, draft, published, published_at")
    .eq("org_id", orgId);
  if (error) throw error;
  const out: Partial<Record<PageChannel, PageDraftState>> = {};
  for (const row of data ?? []) {
    const channel = parsePageChannel(row.channel);
    if (channel) out[channel] = toDraftState(row, orgId);
  }
  return out;
}

/** Fails OPEN: a billing hiccup must never block publishing a page. */
export async function getPageSectionsEntitlement(orgId: string): Promise<PlanLimits["pageSections"]> {
  try {
    if (!(await getDashboardFlags(orgId)).billing) return "all";
    return (await getEntitlements(orgId, await createClient())).pageSections;
  } catch (error) {
    console.error("[billing] page-sections read failed — publish proceeds:", error);
    return "all";
  }
}
