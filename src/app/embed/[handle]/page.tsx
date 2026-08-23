import { notFound } from "next/navigation";
import { getBookingOrg, listPublicOfferings, resolveHandleAlias } from "@/lib/booking/public";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { filterBookableServices } from "@/lib/booking/bookable";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { getOrgBranding } from "@/lib/org-branding";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { badgeVisible } from "@/lib/billing/entitlements";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { EmbedResizeReporter } from "@/features/scheduling/components/embed-resize-reporter";
import { PoweredBy } from "@/components/powered-by";

export default async function EmbedPage({ params, searchParams }: PageProps<"/embed/[handle]">) {
  const { handle: requested } = await params;
  if (!HANDLE_RE.test(requested)) notFound();
  // A snippet pasted on a customer's website carries the handle the org had
  // at the time; after a rename (0052 org_handle_history) it must keep
  // serving the same org. The widget is handed the CURRENT handle — its
  // server actions resolve by handle, and only the current one resolves.
  let handle = requested;
  let org = await getBookingOrg(handle);
  if (!org) {
    const current = await resolveHandleAlias(requested);
    if (current) {
      handle = current;
      org = await getBookingOrg(current);
    }
  }
  if (!org) notFound();
  const [offering, offerings, branding] = await Promise.all([
    // Active-and-linked, then plan-limited — see /book/[handle].
    loadPublicOffering(org.orgId),
    // Rentals parked unless the org's `rentals` flag is on (lib/flags): the widget lists services only.
    getOrgFlagsAdmin(org.orgId).then((f) => (f.rentals ? listPublicOfferings(org.orgId) : [])),
    getOrgBranding(org.orgId),
  ]);
  const { services: orgServices, staff, serviceStaffIds } = offering;
  if (orgServices.length === 0 && offerings.length === 0) notFound();
  // `?staff=` pins the embed to one team member. Unlike /book/[handle]/[slug]
  // this never 404s: the snippet lives on someone else's site, so a staff
  // member who left (or a mistyped slug) must degrade to the org-wide flow
  // rather than break the host page. Resolved from the plan's roster, so a
  // person the plan no longer offers degrades the same way. Shape-checked
  // before it is used at all.
  const staffParam = (await searchParams).staff;
  const staffSlug = typeof staffParam === "string" && STAFF_SLUG_RE.test(staffParam) ? staffParam : null;
  const pinnedStaff = staffSlug ? staff.find((s) => s.slug === staffSlug) ?? null : null;
  // Same reasoning one level down: a pinned person who offers nothing (every
  // service unlinked from them since the snippet was copied) would leave the
  // widget with an empty service step. Drop the lock and show the org flow —
  // the embed degrades, it never breaks.
  const pinnedServices = pinnedStaff
    ? filterBookableServices(orgServices, serviceStaffIds, staff, pinnedStaff.id)
    : [];
  const lockedStaff = pinnedServices.length > 0 ? pinnedStaff : null;
  const services = lockedStaff ? pinnedServices : orgServices;
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
    <WidgetTheme
      config={theme}
      accentColor={branding.accentColor}
      // No painted background unless the org explicitly set one — the
      // widget should sit natively on the host page's own surface.
      transparent={!theme.background}
      className="p-4"
    >
      <EmbedResizeReporter />
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoUrl} alt={org.orgName} className="mb-4 h-8 w-auto" />
      ) : null}
      <BookingWidget
        handle={handle}
        orgTimeZone={org.timeZone}
        services={services}
        offerings={offerings}
        staff={staff}
        serviceStaffIds={serviceStaffIds}
        lockedStaff={lockedStaff}
      />
      {/* Hiding the badge is a paid perk now: the org's toggle only takes
          effect on a plan that allows it (spec §5). */}
      {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
    </WidgetTheme>
  );
}
