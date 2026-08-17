import { notFound } from "next/navigation";
import { getBookingOrg, listPublicOfferings, listPublicServices } from "@/lib/booking/public";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";

export default async function BookPage({ params }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [services, offerings, branding] = await Promise.all([
    listPublicServices(org.orgId),
    listPublicOfferings(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  if (services.length === 0 && offerings.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  return (
    <div className="flex flex-col gap-6">
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
        />
      </WidgetTheme>
    </div>
  );
}
