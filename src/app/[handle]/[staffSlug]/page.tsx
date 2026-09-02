import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getBookingOrg, resolveHandleAlias } from "@/lib/booking/public";
import { bookingPath } from "@/lib/booking/url";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { filterBookableServices } from "@/lib/booking/bookable";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { getOrgBranding } from "@/lib/org-branding";
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

export async function generateMetadata({ params }: PageProps<"/[handle]/[staffSlug]">): Promise<Metadata> {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle) || !STAFF_SLUG_RE.test(staffSlug)) return {};
  const org = await getBookingOrg(handle);
  if (!org) return {};
  return pageMetadata(await getPublishedPage(org.orgId, "appointments"), org, env.NEXT_PUBLIC_SUPABASE_URL, "appointments");
}

// One team member's own booking link: the org's published page with the
// staff section dropped (PageRenderer: lockedStaff ⇒ staffCount 0) and the
// widget locked to this person — only their services, no staff step, no
// "Anyone available". Rentals are org-level, so this page never lists them.
export default async function StaffBookPage({ params, searchParams }: PageProps<"/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (handle !== handle.toLowerCase() && HANDLE_RE.test(handle.toLowerCase())) {
    permanentRedirect(bookingPath(handle.toLowerCase(), staffSlug));
  }
  if (!HANDLE_RE.test(handle)) notFound();
  // Shape-checked before any DB call, exactly like the handle above.
  if (!STAFF_SLUG_RE.test(staffSlug)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) {
    // Renamed org (0052 org_handle_history): follow it, keeping the person.
    const current = await resolveHandleAlias(handle);
    if (current) permanentRedirect(bookingPath(current, staffSlug));
    notFound();
  }
  // A rentals-only org has no public people — this page IS the appointments
  // channel, so its own mode gates it the same way listPublicCatalog would.
  if (!org.offersAppointments) notFound();
  const [offering, branding, doc] = await Promise.all([
    loadPublicOffering(org.orgId),
    getOrgBranding(org.orgId),
    getPublishedPage(org.orgId, "appointments"),
  ]);
  // The roster is active-only AND plan-limited, so both a deactivated person
  // and one the plan no longer offers publicly 404 here — the link stays valid
  // and starts working again the moment they return to the roster.
  const person = offering.staff.find((s) => s.slug === staffSlug);
  if (!person) notFound();
  const services = filterBookableServices(offering.services, offering.serviceStaffIds, [person], person.id);
  // Nothing they can be booked for is not a page worth rendering.
  if (services.length === 0) notFound();
  const theme = parseWidgetTheme(branding.pageThemeRaw);
  const initialServiceId = resolveInitialService(services, (await searchParams).service);
  const ctx: RenderContext = {
    org: { orgId: org.orgId, orgName: org.orgName, handle, timeZone: org.timeZone, currency: org.currency },
    branding: { accentColor: branding.accentColor, logoUrl: branding.logoUrl },
    theme, services,
    // No serviceStaffIds: the map is only needed to filter a staff step this
    // page never shows, and shipping the org's whole service→staff graph to
    // the browser for nothing is worse than letting eligibleFor fall back to
    // `staff` (= [person]).
    staff: [person], offerings: [], lockedStaff: person,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, mode: "public",
    // Not a channel page, but not a dead end either: the header hosts a way
    // back to the org's own page.
    crossLink: { href: bookingPath(handle), label: `← Back to ${org.orgName}` },
  };
  return (
    <div className={bookShellClass(theme.theme)}>
      <WidgetTheme config={theme} accentColor={branding.accentColor} transparent className="flex flex-1 flex-col">
        <main className={cn("mx-auto flex w-full flex-col gap-6 px-6 pt-10 pb-8", pageContainerClass(doc.layout))}>
          <PageRenderer doc={doc} ctx={ctx} initialServiceId={initialServiceId} />
          {/* Same rule as /book/[handle] and the embed (spec §5). */}
          {badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}
        </main>
      </WidgetTheme>
    </div>
  );
}
