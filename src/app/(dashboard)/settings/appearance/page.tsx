import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";

/* Settings › Appearance: how the admin looks to you (per-browser). */
export default function AppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">Interface</h2>
      <AppearanceSettings />
    </div>
  );
}
