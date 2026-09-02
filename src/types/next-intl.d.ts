import type en from "../../messages/en.json";
import type { LOCALES } from "@/i18n/config";

// Message keys and the Locale type flow from en.json and LOCALES (spec §6):
// t("auth.login.titel") is a type error, useLocale() returns Locale.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}
