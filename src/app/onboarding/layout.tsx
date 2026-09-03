import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { LocaleNotice } from "@/i18n/locale-notice";

/* /onboarding sits outside (dashboard) and (auth), so it carries its own
   provider (i18n Wave 3): the interface locale, all messages, `lang` on the
   wrapper — the root <html lang> stays "en" until Wave 5 (spec §3). */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <NextIntlClientProvider>
      <div lang={locale} className="contents">
        <LocaleNotice />
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
