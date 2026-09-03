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
import { setRequestLocale } from "next-intl/server";
import { publicLocale } from "@/i18n/public";
import { PublicIntl } from "@/i18n/public-provider";
import { PublicLanguageLinks } from "@/i18n/public-language-links";
import { getPublishedPage } from "../queries";
import type { PageChannel } from "../channel";
import { resolveInitialOffering, resolveInitialService } from "../initial-service";
import type { RenderContext } from "./context";
import { PageRenderer, pageContainerClass } from "./page-renderer";

type Catalogue = Awaited<ReturnType<typeof listPublicCatalog>>;

/* The org's channel page (spec 2026-08-28 §3, one per org since 0073).
   The route has already resolved the channel (frontDoor) and handled its
   404; this reads that channel's published document and renders the same
   shell the page always had. The gated catalogue is already one channel. */
export async function renderChannelPage({
  org, handle, channel, catalogue, searchParams,
}: {
  org: BookingOrg; handle: string; channel: PageChannel; catalogue: Catalogue;
  searchParams: { service?: string | string[]; space?: string | string[]; lang?: string | string[] };
}) {
  const { offering, offerings } = catalogue;
  // The page's language (spec §4 + region): decided once here, before any
  // translation runs, and handed to the client tree by PublicIntl below.
  const locale = await publicLocale(org.locale, searchParams);
  setRequestLocale(locale);
  const [branding, doc] = await Promise.all([getOrgBranding(org.orgId), getPublishedPage(org.orgId, channel)]);
  const theme = parseWidgetTheme(branding.pageThemeRaw);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone, currency: org.currency },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services: offering.services, staff: offering.staff, serviceStaffIds: offering.serviceStaffIds, offerings, lockedStaff: null,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public", crossLink: null,
  };
  return (
    <PublicIntl locale={locale} timeZone={org.timeZone}>
    {/* The whole page takes the org's widget theme (light / dark / auto), so
        the transparent widget always sits on a matching surface — the same
        guarantee the embed can't give on a third-party site. */}
    <div className={bookShellClass(theme.theme)}>
      {/* Theme tokens (font, radius, accent, text, lines) for every section;
          always transparent — the shell paints the ground. The booking
          section nests its own WidgetTheme for the widget's surface. */}
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 px-6 pt-10 pb-8", pageContainerClass(doc.layout))}>
          <PageRenderer
            doc={doc}
            ctx={ctx}
            initialServiceId={resolveInitialService(offering.services, searchParams.service)}
            initialOfferingId={resolveInitialOffering(offerings, searchParams.space)}
          />
          {/* Same rule as the embed: the badge shows unless the org both asked
              to hide it and is on a plan that may (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
          {/* The visitor's escape hatch, its own element: the badge above is
              hideable on a paid plan and the language links are not. */}
          <PublicLanguageLinks locale={locale} />
        </main>
      </WidgetTheme>
    </div>
    </PublicIntl>
  );
}
