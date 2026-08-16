import { notFound } from "next/navigation";
import { getBookingOrg, listPublicServices } from "@/lib/booking/public";
import { getOrgBranding } from "@/lib/org-branding";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { EmbedResizeReporter } from "@/features/scheduling/components/embed-resize-reporter";
import { env } from "@/env";

export default async function EmbedPage({ params }: PageProps<"/embed/[handle]">) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [services, branding] = await Promise.all([
    listPublicServices(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  if (services.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  return (
    // No min-h-dvh here: `dvh` resolves against the IFRAME's own viewport,
    // which is whatever height embed.js last set — so it floors
    // body.offsetHeight at the current iframe height and neutralizes the
    // shrink fix in EmbedResizeReporter (a booking growing then shrinking
    // could never report a smaller height). Once embed.js sizes the iframe
    // to exactly body.offsetHeight, this wrapper fills the iframe on its
    // own; the moment before the first resize message is covered by the
    // transparent html/body background in embed/layout.tsx instead.
    <WidgetTheme config={theme} accentColor={branding.accentColor} className="p-4">
      <EmbedResizeReporter />
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoUrl} alt={org.orgName} className="mb-4 h-8 w-auto" />
      ) : null}
      <BookingWidget handle={handle} orgTimeZone={org.timeZone} services={services} />
      {theme.hidePoweredBy ? null : (
        <p className="mt-4 text-center text-xs opacity-60">
          <a href={env.NEXT_PUBLIC_APP_URL} target="_blank" rel="noopener noreferrer">
            Powered by RolloutOS
          </a>
        </p>
      )}
    </WidgetTheme>
  );
}
