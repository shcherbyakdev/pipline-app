import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth/session";
import { getBrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { env } from "@/env";
import { modeChoice } from "@/features/orgs/schema";
import { listServices } from "@/features/scheduling/queries";
import { listOfferings } from "@/features/rentals/queries";
import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";
import { LanguageSettings } from "@/features/orgs/components/language-settings";
import { BusinessSettings } from "@/features/orgs/components/business-settings";
import { ClientContactSettings } from "@/features/orgs/components/client-contact-settings";
import { PageIntro } from "@/components/shell/page-header";
import { SettingsCard } from "@/components/settings-row";

/* Settings = the admin panel (per-user Interface prefs) plus the org-level
   "Business" group: what you offer, client contact, the page address with
   timezone, currency and language, and the brand (logo, accent). Every card
   saves on its own — the studio keeps only what publishes with the page
   (design once, share once, spec 2026-09-16).

   One card per group, hairline rows inside, every choice on a dropdown at
   the right edge (Linear's Preferences). Each row saves on pick. */
export default async function SettingsPage() {
  const [{ org }, t, branding, scheduling] = await Promise.all([requireOrg(), getTranslations("settings"), getBrandingSettings(), getSchedulingSettings()]);
  if (!branding || !scheduling) notFound();
  const mode = modeChoice(org);
  // The channel is a live choice only while nothing active has been built on
  // it (update_org_modes enforces the same rule); after that Settings shows a
  // fixed label, so an established org never sees the other channel offered.
  const locked =
    mode === "appointments" ? (await listServices()).some((s) => s.active) : (await listOfferings()).some((o) => o.active);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <PageIntro>{t("intro")}</PageIntro>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.interface")}</h2>
        <SettingsCard>
          <AppearanceSettings />
          <LanguageSettings />
        </SettingsCard>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.business")}</h2>
        <SettingsCard>
          <BusinessSettings mode={mode} locked={locked} />
          <ClientContactSettings value={org.clientContact} />
        </SettingsCard>
        <SchedulingSettingsForm settings={scheduling} appUrl={env.NEXT_PUBLIC_APP_URL} />
        <SettingsCard title={t("brand.title")} description={t("brand.blurb")}>
          <BrandingForm settings={branding} />
        </SettingsCard>
      </section>
    </div>
  );
}
