import { notFound } from "next/navigation";
import { getBookingOrg, listPublicOfferings } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { getOrgBranding } from "@/lib/org-branding";
import { RENTALS_ENABLED } from "@/lib/flags";
import { badgeVisible } from "@/lib/billing/entitlements";
import { BrandedHeader } from "@/components/branded-header";
import { PoweredBy } from "@/components/powered-by";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";

export default async function BookPage({
  params,
}: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [offering, offerings, branding] = await Promise.all([
    // The org's roster and services, already narrowed to what someone active
    // can be booked for AND to what the org's plan may offer publicly.
    loadPublicOffering(org.orgId),
    // Rentals parked for the MVP (lib/flags.ts): the widget lists services only.
    RENTALS_ENABLED ? listPublicOfferings(org.orgId) : Promise.resolve([]),
    getOrgBranding(org.orgId),
  ]);
  const { services, staff, serviceStaffIds } = offering;
  if (services.length === 0 && offerings.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  return (
    // The whole page takes the org's widget theme (light / dark / auto), so
    // the transparent widget always sits on a matching surface — the same
    // guarantee the embed can't give on a third-party site.
    <div className={bookShellClass(theme.theme)}>
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
        <BrandedHeader
          orgName={org.orgName}
          accentColor={branding.accentColor}
          logoUrl={branding.logoUrl}
        />
        <WidgetTheme
          config={theme}
          accentColor={branding.accentColor}
          // Same rule as /embed: the widget paints no background of its own
          // unless the org explicitly set one — the page shell already
          // provides the surface (a near-match theme bg here reads as a
          // visible seam around the widget).
          transparent={!theme.background}
        >
          <BookingWidget
            handle={handle}
            orgTimeZone={org.timeZone}
            services={services}
            offerings={offerings}
            staff={staff}
            serviceStaffIds={serviceStaffIds}
          />
        </WidgetTheme>
        {/* Same rule as the embed: the badge shows unless the org both asked
            to hide it and is on a plan that may (spec §5). */}
        {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
      </main>
    </div>
  );
}
