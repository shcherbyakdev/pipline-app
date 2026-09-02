import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

/* Auth is the seam between the landing and the admin: the landing's ground,
   the wordmark up top, the form sitting directly on it — no panel, a narrow
   centred column (the Linear-style auth composition). Pages render only
   their content; this shell owns the composition, and the language switch
   sits under the column (the pre-login way to pick a language). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("common")]);
  return (
    <NextIntlClientProvider>
      <main lang={locale} className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 p-6">
        <Link
          href="/"
          className="text-foreground focus-visible:ring-ring focus-visible:ring-offset-background rounded-sm text-[23px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
        >
          <BookloWordmark />
        </Link>
        <div className="w-full max-w-[340px]">{children}</div>
        <LocaleSwitcher label={t("language")} />
      </main>
    </NextIntlClientProvider>
  );
}
