import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";
import { PageIntro } from "@/components/shell/page-header";

/* Settings = the admin panel itself (per-user preferences; later account,
   notifications). Anything clients see lives on Booking page / Website embed. */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageIntro>How the admin looks to you. These apply only to you, in this browser.</PageIntro>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Interface</h2>
        <AppearanceSettings />
      </div>
    </div>
  );
}
