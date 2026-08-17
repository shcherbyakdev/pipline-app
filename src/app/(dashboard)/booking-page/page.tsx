import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { BookingPageStudio } from "@/features/orgs/components/booking-page-studio";
import { listServices } from "@/features/scheduling/queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import { PageIntro } from "@/components/shell/page-header";
import { env } from "@/env";

/* Booking page: the hosted channel — its address, timezone and branding,
   edited against a live preview of the page itself. (Branding's accent is
   shared with the website embed.) */
export default async function BookingPagePage() {
  const [branding, scheduling, services] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
  ]);
  if (!branding || !scheduling) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Set its address and timezone, then brand it.</PageIntro>
      <BookingPageStudio
        branding={branding}
        scheduling={scheduling}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={toPreviewServices(services)}
      />
    </div>
  );
}
