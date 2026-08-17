import { notFound } from "next/navigation";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { PageIntro } from "@/components/shell/page-header";

/* Booking page: the hosted channel — its address, timezone and branding.
   (Branding's accent colour is shared with the website embed.) */
export default async function BookingPagePage() {
  const [settings, schedulingSettings] = await Promise.all([
    getBrandingSettings(),
    getSchedulingSettings(),
  ]);
  if (!settings || !schedulingSettings) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageIntro>The page clients book you on. Set its address and timezone, then brand it.</PageIntro>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Address & timezone</h2>
        <SchedulingSettingsForm settings={schedulingSettings} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
    </div>
  );
}
