import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getBookingOrg, resolveHandleAlias } from "@/lib/booking/public";
import { channelPath, channelUrl } from "@/lib/booking/url";
import { listPublicCatalog, catalogueHas } from "@/lib/booking/catalog";
import { resolveChannelPage, type Has } from "@/lib/booking/channel-pages";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { renderChannelPage } from "@/features/booking-page/render/channel-page";
import { HANDLE_RE } from "@/features/scheduling/handle";

// The spaces page (spec 2026-08-28 §3.3): always the spaces channel while a
// space is bookable, so a shared link never breaks when the org later adds
// a service and the root moves. Next matches this static segment before
// /[handle]/[staffSlug] — hence "spaces" is a reserved staff slug.
export async function generateMetadata({ params }: PageProps<"/[handle]/spaces">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  const page = resolveChannelPage("spaces", catalogueHas(await listPublicCatalog(org)));
  if (!page) return {};
  return {
    ...pageMetadata(await getPublishedPage(org.orgId, page.channel), org, env.NEXT_PUBLIC_SUPABASE_URL, page.channel),
    // A spaces-only org's spaces page IS the root: say so to crawlers.
    alternates: { canonical: channelUrl(env.NEXT_PUBLIC_APP_URL, handle, page.canonical === "root" ? "appointments" : "spaces") },
  };
}

export default async function SpacesPage({ params, searchParams }: PageProps<"/[handle]/spaces">) {
  const { handle } = await params;
  if (handle !== handle.toLowerCase() && HANDLE_RE.test(handle.toLowerCase())) {
    permanentRedirect(channelPath(handle.toLowerCase(), "spaces"));
  }
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) {
    const current = await resolveHandleAlias(handle);
    if (current) permanentRedirect(channelPath(current, "spaces"));
    notFound();
  }
  const catalogue = await listPublicCatalog(org);
  const has: Has = catalogueHas(catalogue);
  const page = resolveChannelPage("spaces", has);
  if (!page) notFound();
  return renderChannelPage({ org, handle, page, catalogue, searchParams: await searchParams });
}
