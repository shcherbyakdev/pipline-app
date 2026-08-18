import { notFound } from "next/navigation";
import { getBookingOrg, getPublicStaffBySlug } from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { filterBookableServices } from "@/lib/booking/bookable";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { WidgetTheme } from "@/components/widget-theme";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { bookShellClass } from "@/lib/book-shell";

// One team member's own booking link. Same shell as /book/[handle]; the
// differences are all narrowing: only this person's services, no staff step,
// no "Anyone available". Rentals are org-level (no staff at all), so this
// page never lists offerings.
export default async function StaffBookPage({
  params,
}: PageProps<"/book/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  // Shape-checked before any DB call, exactly like the handle above.
  if (!STAFF_SLUG_RE.test(staffSlug)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  // Inactive staff resolve to null here — a deactivated person's link 404s
  // rather than silently redirecting to the whole-team page.
  const person = await getPublicStaffBySlug(org.orgId, staffSlug);
  if (!person) notFound();
  const [offering, branding] = await Promise.all([
    loadPublicOffering(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  // Someone the plan doesn't offer publicly 404s exactly like a deactivated
  // person: the link stays valid the moment the org upgrades again.
  if (!offering.staff.some((s) => s.id === person.id)) notFound();
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
      </main>
    </div>
  );
}
