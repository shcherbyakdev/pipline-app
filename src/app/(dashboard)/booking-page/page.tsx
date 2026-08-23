import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import { getPageDraftState, getPageSectionsEntitlement } from "@/features/booking-page/queries";
import { BookingPageBuilder } from "@/features/booking-page/studio/booking-page-builder";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its sections, address, timezone and
   branding, edited against a live preview of the page itself and published
   explicitly. (Branding's accent and theme are shared with the website embed.) */
export default async function BookingPagePage() {
  const [branding, scheduling, services, staff] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
    listStaff(),
  ]);
  if (!branding || !scheduling) notFound();
  const [page, pageSections] = await Promise.all([
    getPageDraftState(branding.orgId),
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
        previewServices={toPreviewServices(services)}
        // The preview's Team section shows the real active roster (public shape: never email).
        staff={staff.filter((s) => s.active).map(({ id, name, slug, color }) => ({ id, name, slug, color }))}
        initialPage={{ draft: page.draft, published: page.published }}
        pageSections={pageSections}
      />
    </div>
  );
}
