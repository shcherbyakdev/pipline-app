import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingOrg, listPublicOfferings } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { getOrgBranding } from "@/lib/org-branding";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { badgeVisible } from "@/lib/billing/entitlements";
import { PoweredBy } from "@/components/powered-by";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { getPublishedPage } from "@/features/booking-page/queries";
import { pageMetadata } from "@/features/booking-page/metadata";
import { resolveInitialService } from "@/features/booking-page/initial-service";
import type { RenderContext } from "@/features/booking-page/render/context";
import { PageRenderer, pageContainerClass } from "@/features/booking-page/render/page-renderer";

import { HANDLE_RE } from "@/features/scheduling/handle";

export async function generateMetadata({ params }: PageProps<"/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  return pageMetadata(await getPublishedPage(org.orgId), org, env.NEXT_PUBLIC_SUPABASE_URL);
}

export default async function BookPage({ params, searchParams }: PageProps<"/[handle]">) {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [offering, offerings, branding, doc] = await Promise.all([
    // The org's roster and services, already narrowed to what someone active
    // can be booked for AND to what the org's plan may offer publicly.
    loadPublicOffering(org.orgId),
    // Rentals parked unless the org's `rentals` flag is on (lib/flags): the widget lists services only.
    getOrgFlagsAdmin(org.orgId).then((f) => (f.rentals ? listPublicOfferings(org.orgId) : [])),
    getOrgBranding(org.orgId),
    // The org's published composition; the default page when none.
    getPublishedPage(org.orgId),
  ]);
  const { services, staff, serviceStaffIds } = offering;
  if (services.length === 0 && offerings.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  const initialServiceId = resolveInitialService(services, (await searchParams).service);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services, staff, serviceStaffIds, offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public",
  };
  return (
    // The whole page takes the org's widget theme (light / dark / auto), so
    // the transparent widget always sits on a matching surface — the same
    // guarantee the embed can't give on a third-party site.
    <div className={bookShellClass(theme.theme)}>
      {/* Theme tokens (font, radius, accent, text, lines) for every section;
          always transparent — the shell paints the ground. The booking
          section nests its own WidgetTheme for the widget's surface. */}
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 p-6", pageContainerClass(doc.layout))}>
          <PageRenderer doc={doc} ctx={ctx} initialServiceId={initialServiceId} />
          {/* Same rule as the embed: the badge shows unless the org both asked
              to hide it and is on a plan that may (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
