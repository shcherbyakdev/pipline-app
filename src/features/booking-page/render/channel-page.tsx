import { getOrgBranding } from "@/lib/org-branding";
import { badgeVisible } from "@/lib/billing/entitlements";
import { PoweredBy } from "@/components/powered-by";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import type { BookingOrg } from "@/lib/booking/public";
import type { listPublicCatalog } from "@/lib/booking/catalog";
import { applyChannel } from "@/lib/booking/channel";
import { bookingPath, channelPath } from "@/lib/booking/url";
import type { ChannelPage } from "@/lib/booking/channel-pages";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { getPublishedPage } from "../queries";
import { toCatalogChannel } from "../channel";
import { resolveInitialOffering, resolveInitialService } from "../initial-service";
import type { RenderContext } from "./context";
import { PageRenderer, pageContainerClass } from "./page-renderer";

type Catalogue = Awaited<ReturnType<typeof listPublicCatalog>>;

/* One channel page (spec 2026-08-28 §3): /[handle] and /[handle]/spaces
   both come through here so they cannot drift. The route has already
   resolved WHICH page (resolveChannelPage) and handled its 404/redirect;
   this forces the catalogue to that channel, reads that channel's
   published document and renders the same shell the page always had. */
export async function renderChannelPage({
  org, handle, page, catalogue, searchParams,
}: {
  org: BookingOrg; handle: string; page: ChannelPage; catalogue: Catalogue;
  searchParams: { service?: string | string[]; space?: string | string[] };
}) {
  const { offering, offerings } = catalogue;
  const [branding, doc] = await Promise.all([getOrgBranding(org.orgId), getPublishedPage(org.orgId, page.channel)]);
  const theme = parseWidgetTheme(branding.themeRaw);
  // The page's channel is forced — no longer a query — before the widget,
  // its headings and the builder's Services / Spaces / Staff sections read
  // it, so they all agree (publicSections drops the emptied sections).
  const cat = applyChannel(
    { services: offering.services, staff: offering.staff, serviceStaffIds: offering.serviceStaffIds, offerings },
    toCatalogChannel(page.channel),
  );
  // The other channel's page, when it has something to book (§3.5).
  const crossLink: RenderContext["crossLink"] =
    page.channel === "appointments" && offerings.length > 0
      ? { href: channelPath(handle, "spaces"), label: SPACES.crossLink }
      : page.channel === "spaces" && offering.services.length > 0
        ? { href: bookingPath(handle), label: APPOINTMENTS.crossLink }
        : null;
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone, currency: org.currency },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services: cat.services, staff: cat.staff, serviceStaffIds: cat.serviceStaffIds, offerings: cat.offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public", crossLink,
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
          <PageRenderer
            doc={doc}
            ctx={ctx}
            initialServiceId={resolveInitialService(cat.services, searchParams.service)}
            initialOfferingId={resolveInitialOffering(cat.offerings, searchParams.space)}
          />
          {/* Same rule as the embed: the badge shows unless the org both asked
              to hide it and is on a plan that may (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
