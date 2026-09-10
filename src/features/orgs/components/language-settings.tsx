import { getTranslations } from "next-intl/server";
import { SettingsPrefRow } from "@/components/settings-row";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/* Settings › Interface › Language: the person's admin language (spec §4).
   What clients see is the org locale, set on the Booking page (Wave 1). */
export async function LanguageSettings() {
  const t = await getTranslations("settings.language");
  return (
    <SettingsPrefRow label={t("title")} blurb={t("blurb")}>
      <LocaleSwitcher label={t("label")} />
    </SettingsPrefRow>
  );
}
