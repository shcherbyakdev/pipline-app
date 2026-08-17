import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { listServices } from "@/features/scheduling/queries";
import type { PublicService } from "@/lib/booking/public";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { env } from "@/env";
import { PageIntro } from "@/components/shell/page-header";

// Only used when the org has zero active services — keeps the preview
// widget functional so appearance can still be judged before any service
// exists.
const CANNED_PREVIEW_SERVICE: PublicService = {
  id: "preview-service",
  name: "Consultation",
  description: null,
  durationMin: 30,
  priceLabel: null,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minNoticeMin: 0,
  maxPerDay: null,
  bookingWindowDays: 30,
};

/* Website embed: the second booking channel — the widget on the org's own
   site. Style it against a live preview, then copy the snippet. */
export default async function EmbedPage() {
  const [settings, schedulingSettings, services] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
  ]);
  if (!settings || !schedulingSettings) notFound();

  const activeServices: PublicService[] = services
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceLabel: s.priceLabel,
      bufferBeforeMin: s.bufferBeforeMin,
      bufferAfterMin: s.bufferAfterMin,
      minNoticeMin: s.minNoticeMin,
      maxPerDay: s.maxPerDay,
      bookingWindowDays: s.bookingWindowDays,
    }));
  const previewServices = activeServices.length > 0 ? activeServices : [CANNED_PREVIEW_SERVICE];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageIntro>
        Add booking to your own site. Style the widget against the live preview, then paste the snippet
        into your page. Logo and accent colour come from Booking page › Branding.
      </PageIntro>
      <WidgetAppearance
        initial={parseWidgetTheme(settings.widgetTheme)}
        accentColor={settings.accentColor}
        handle={schedulingSettings.handle}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        previewServices={previewServices}
      />
    </div>
  );
}
