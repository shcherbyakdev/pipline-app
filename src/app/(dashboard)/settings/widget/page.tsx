import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { listServices } from "@/features/scheduling/queries";
import type { PublicService } from "@/lib/booking/public";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { env } from "@/env";

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

/* Settings › Widget & embed: how the embeddable widget looks on the org's own
   site, with a live preview and the snippet to paste. */
export default async function WidgetSettingsPage() {
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
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-muted-foreground text-sm font-medium">Widget appearance</h2>
        <p className="text-muted-foreground text-sm">
          Styles the widget you embed on your own site. The hosted booking page uses the branding on the
          General tab.
        </p>
      </div>
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
