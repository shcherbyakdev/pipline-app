"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { SettingsSelect } from "@/components/settings-select";
import { LOCALES, LOCALE_NAMES, type Locale } from "./config";
import { setLocale } from "./actions";

/* The one language control (Settings › Interface only — the auth pages
   detect the language and show LocaleNotice instead, ruling 2026-09-03).
   Server and client agree on the locale — it is a cookie read on the server —
   so unlike the theme picker nothing waits for mount. Each option carries its
   own lang: a screen reader says "Українська" in Ukrainian. */
export function LocaleSwitcher({ label }: { label: string }) {
  const current = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  return (
    <SettingsSelect
      label={label}
      value={current}
      busy={pending}
      disabled={pending}
      options={LOCALES.map((locale) => ({ value: locale, label: LOCALE_NAMES[locale], lang: locale }))}
      onSelect={(locale) => startTransition(() => setLocale(locale))}
    />
  );
}
