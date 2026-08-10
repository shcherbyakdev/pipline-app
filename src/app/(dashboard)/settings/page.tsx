import { notFound } from "next/navigation";
import { getBrandingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";

export default async function SettingsPage() {
  const settings = await getBrandingSettings();
  if (!settings) notFound();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
    </div>
  );
}
