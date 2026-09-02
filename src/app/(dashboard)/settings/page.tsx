import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth/session";
import { modeOf } from "@/features/orgs/mode";
import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";
import { LanguageSettings } from "@/features/orgs/components/language-settings";
import { BusinessSettings } from "@/features/orgs/components/business-settings";
import { PageIntro } from "@/components/shell/page-header";

/* Settings = the admin panel (per-user Interface prefs) plus one org-level
   "Business" group (H1 ruling; future home for org name / timezone). Anything
   clients see lives on Booking page / Website embed. */
export default async function SettingsPage() {
  const [{ org }, t] = await Promise.all([requireOrg(), getTranslations("settings")]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageIntro>{t("intro")}</PageIntro>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.interface")}</h2>
        <AppearanceSettings />
        <LanguageSettings />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.business")}</h2>
        <BusinessSettings mode={modeOf(org)} />
      </div>
    </div>
  );
}
