"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import { LOCALES, LOCALE_NAMES } from "./config";
import { setLocale } from "./actions";

/* The one language control (Settings › Interface only — the auth pages
   detect the language and show LocaleNotice instead, ruling 2026-09-03). Server
   and client agree on the locale — it is a cookie read on the server — so
   unlike the theme picker nothing waits for mount. Each button carries its
   own lang: a screen reader says "Українська" in Ukrainian. */
export function LocaleSwitcher({ label }: { label: string }) {
  const current = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <div role="radiogroup" aria-label={label} aria-busy={pending} className={SEGMENTED_NAV_CLASS}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          role="radio"
          lang={locale}
          aria-checked={current === locale}
          disabled={pending}
          onClick={() => {
            if (locale !== current) startTransition(() => setLocale(locale));
          }}
          className={segmentedItemClass(current === locale)}
        >
          {LOCALE_NAMES[locale]}
        </button>
      ))}
    </div>
  );
}
