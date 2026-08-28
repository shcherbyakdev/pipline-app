import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getBookingOrg, resolveHandleAlias } from "@/lib/booking/public";
import { bookingPath, channelPath } from "@/lib/booking/url";
import { listPublicCatalog, catalogueHas } from "@/lib/booking/catalog";
import { resolveChannelPage, type Has } from "@/lib/booking/channel-pages";
import { resolveChannelParam } from "@/lib/booking/channel";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { renderChannelPage } from "@/features/booking-page/render/channel-page";
import { HANDLE_RE } from "@/features/scheduling/handle";

// The root page: appointments when a service is bookable, else spaces
// (spec 2026-08-28 §3.1). listPublicCatalog is memoised per request, so
// generateMetadata and the page resolve the same channel from one read.
export async function generateMetadata({ params }: PageProps<"/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  const page = resolveChannelPage("root", catalogueHas(await listPublicCatalog(org)));
  if (!page) return {};
  return pageMetadata(await getPublishedPage(org.orgId, page.channel), org, env.NEXT_PUBLIC_SUPABASE_URL, page.channel);
}

export default async function BookPage({ params, searchParams }: PageProps<"/[handle]">) {
  const { handle } = await params;
  // Typed with capitals (a business card, a spoken URL) → the canonical
  // lowercase address; anything else off-shape is a 404.
  if (handle !== handle.toLowerCase() && HANDLE_RE.test(handle.toLowerCase())) {
    permanentRedirect(bookingPath(handle.toLowerCase()));
  }
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) {
    // A handle the org renamed away from (0052 org_handle_history) keeps
    // working: old emails and printed links follow the org.
    const current = await resolveHandleAlias(handle);
    if (current) permanentRedirect(bookingPath(current));
    notFound();
  }
  // The gated catalogue: services/staff and offerings, each present only
  // while its channel (org mode, and for rentals the feature flag too) is on.
  const catalogue = await listPublicCatalog(org);
  const has: Has = catalogueHas(catalogue);
  const page = resolveChannelPage("root", has);
  if (!page) notFound();
  const sp = await searchParams;
  // `?channel=spaces` predates the spaces page (admin IA spec §5): it now
  // means that page. Temporary — it depends on data. `?channel=services`
  // is the root already (or degrades exactly as applyChannel did).
  if (resolveChannelParam(sp.channel) === "spaces" && page.channel === "appointments" && has.spaces) {
    redirect(channelPath(handle, "spaces"));
  }
  return renderChannelPage({ org, handle, page, catalogue, searchParams: sp });
}
