import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
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

export default async function SettingsPage() {
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Booking page</h2>
        <SchedulingSettingsForm settings={schedulingSettings} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Widget appearance</h2>
        <WidgetAppearance
          initial={parseWidgetTheme(settings.widgetTheme)}
          accentColor={settings.accentColor}
          handle={schedulingSettings.handle}
          appUrl={env.NEXT_PUBLIC_APP_URL}
          previewServices={previewServices}
        />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Appearance</h2>
        <AppearanceSettings />
      </div>
    </div>
  );
}
