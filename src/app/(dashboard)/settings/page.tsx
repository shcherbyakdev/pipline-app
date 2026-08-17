import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";

/* Settings › General: the hosted booking page (handle, timezone) and the
   branding clients see there. The embeddable widget lives on its own tab. */
export default async function SettingsPage() {
  const [settings, schedulingSettings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
  ]);
  if (!settings || !schedulingSettings) notFound();

  return (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Booking page</h2>
        <SchedulingSettingsForm settings={schedulingSettings} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
    </>
  );
}
