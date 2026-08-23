import { notFound } from "next/navigation";
import { getBookingOrg } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { filterBookableServices } from "@/lib/booking/bookable";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { getOrgBranding } from "@/lib/org-branding";
import { badgeVisible } from "@/lib/billing/entitlements";
import { BrandedHeader } from "@/components/branded-header";
import { PoweredBy } from "@/components/powered-by";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";

// One team member's own booking link. Same shell as /[handle]; the
// differences are all narrowing: only this person's services, no staff step,
// no "Anyone available". Rentals are org-level (no staff at all), so this
// page never lists offerings.
export default async function StaffBookPage({
  params,
}: PageProps<"/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  // Shape-checked before any DB call, exactly like the handle above.
  if (!STAFF_SLUG_RE.test(staffSlug)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [offering, branding] = await Promise.all([
    loadPublicOffering(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  // The roster is active-only AND plan-limited, so both a deactivated person
  // and one the plan no longer offers publicly 404 here — the link stays valid
  // and starts working again the moment they return to the roster.
  const person = offering.staff.find((s) => s.slug === staffSlug);
  if (!person) notFound();
  const services = filterBookableServices(offering.services, offering.serviceStaffIds, [person], person.id);
  // Nothing they can be booked for is not a page worth rendering.
  if (services.length === 0) notFound();
  const theme = parseWidgetTheme(branding.themeRaw);
  return (
    <div className={bookShellClass(theme.theme)}>
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
        <BrandedHeader
          orgName={org.orgName}
          accentColor={branding.accentColor}
          logoUrl={branding.logoUrl}
          subtitle={`Booking with ${person.name}`}
        />
        <WidgetTheme
          config={theme}
          accentColor={branding.accentColor}
          transparent={!theme.background}
        >
          <BookingWidget
            handle={handle}
            orgTimeZone={org.timeZone}
            services={services}
            staff={[person]}
            // No serviceStaffIds: the map is only needed to filter a staff
            // step this page never shows, and shipping the org's whole
            // service→staff graph to the browser for nothing is worse than
            // letting eligibleFor fall back to `staff` (= [person]).
            lockedStaff={person}
          />
        </WidgetTheme>
        {/* Same rule as /[handle] and the embed (spec §5). */}
        {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
      </main>
    </div>
  );
}
