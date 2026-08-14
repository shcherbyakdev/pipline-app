import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";

export default async function SettingsPage() {
  const [settings, schedulingSettings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
  ]);
  if (!settings || !schedulingSettings) notFound();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Booking page</h2>
        <SchedulingSettingsForm settings={schedulingSettings} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
    </div>
  );
}
