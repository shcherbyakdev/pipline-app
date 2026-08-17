import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { WidgetAppearance } from "@/features/orgs/components/widget-appearance";
import { listServices } from "@/features/scheduling/queries";
import { toPreviewServices } from "@/features/scheduling/preview-services";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { env } from "@/env";
import { PageIntro } from "@/components/shell/page-header";

/* Website embed: the second booking channel — the widget on the org's own
   site. Style it against a live preview, then copy the snippet. */
export default async function EmbedPage() {
  const [settings, schedulingSettings, services] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
    listServices(),
  ]);
  if (!settings || !schedulingSettings) notFound();

  const previewServices = toPreviewServices(services);

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
