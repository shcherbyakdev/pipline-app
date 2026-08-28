import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { effectiveMode, modeOf, presentMode } from "@/features/orgs/mode";
import { isBookableOffering, toPreviewCatalog } from "@/lib/booking/preview-catalog";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getPageDraftState, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import type { PageChannel } from "@/features/booking-page/channel";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.) */
export default async function BookingPagePage() {
  // The preview shows the channels the public page shows (listPublicCatalog's
  // rules): declared mode ∩ the rentals kill switch, same as /bookings —
  // then narrowed to what actually has something bookable (presentMode), so
  // an org that declared spaces but only ever added services previews,
  // templates and lists sections as the appointments page it is.
  const { org } = await requireOrg();
  const declared = effectiveMode(await getDashboardFlags(org.id), modeOf(org));
  // Interim until Task 8: the page of the org's first declared channel.
  const channel: PageChannel = declared.offersAppointments ? "appointments" : "spaces";
  const [branding, scheduling, services, staff, offerings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
    declared.offersRentals ? listOfferings() : [],
  ]);
  if (!branding || !scheduling) notFound();
  const mode = presentMode(declared, {
    services: services.some((s) => s.active),
    spaces: offerings.some(isBookableOffering),
  });
  const catalog = toPreviewCatalog({ mode, services, offerings });
  const [page, pageSections] = await Promise.all([
    getPageDraftState(branding.orgId, channel),
    getPageSectionsEntitlement(branding.orgId),
  ]);

  return (
    // Wider than the other settings pages: the preview must be able to show
    // the split layout (≥ 48rem of page column) at desktop.
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Arrange its sections, brand it, then publish.</PageIntro>
      <BookingPageBuilder
        branding={branding}
        scheduling={scheduling}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
        previewServices={catalog.services}
        previewOfferings={catalog.offerings}
        // The preview's Team section shows the real active roster (public shape: never email).
        staff={staff.filter((s) => s.active).map(({ id, name, slug, color }) => ({ id, name, slug, color }))}
        initialPage={{ draft: page.draft, published: page.published }}
        pageSections={pageSections}
        mode={mode}
        channel={channel}
      />
    </div>
  );
}
