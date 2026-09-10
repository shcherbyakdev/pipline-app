import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth/session";
import { modeChoice } from "@/features/orgs/schema";
import { listServices } from "@/features/scheduling/queries";
import { listOfferings } from "@/features/rentals/queries";
import { AppearanceSettings } from "@/features/orgs/components/appearance-settings";
import { LanguageSettings } from "@/features/orgs/components/language-settings";
import { BusinessSettings } from "@/features/orgs/components/business-settings";
import { ClientContactSettings } from "@/features/orgs/components/client-contact-settings";
import { PageIntro } from "@/components/shell/page-header";

/* Settings = the admin panel (per-user Interface prefs) plus one org-level
   "Business" group (H1 ruling; future home for org name / timezone). Anything
   clients see lives on Booking page / Website embed. */
export default async function SettingsPage() {
  const [{ org }, t] = await Promise.all([requireOrg(), getTranslations("settings")]);
  const mode = modeChoice(org);
  // The channel is a live choice only while nothing active has been built on
  // it (update_org_modes enforces the same rule); after that Settings shows a
  // fixed label, so an established org never sees the other channel offered.
  const locked =
    mode === "appointments" ? (await listServices()).some((s) => s.active) : (await listOfferings()).some((o) => o.active);
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
        <BusinessSettings mode={mode} locked={locked} />
        <ClientContactSettings value={org.clientContact} />
      </div>
    </div>
  );
}
