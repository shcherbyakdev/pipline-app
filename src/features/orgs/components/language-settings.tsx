import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/* Settings › Interface › Language: the person's admin language (spec §4).
   What clients see is the org locale, set on the Booking page (Wave 1). */
export async function LanguageSettings() {
  const t = await getTranslations("settings.language");
  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("title")}</div>
        <p className="text-muted-foreground text-sm">{t("blurb")}</p>
      </div>
      <LocaleSwitcher label={t("label")} />
    </div>
  );
}
