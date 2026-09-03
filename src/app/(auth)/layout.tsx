import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { BookloWordmark } from "@/features/marketing/components/booklo-mark";
import { LocaleNotice } from "@/i18n/locale-notice";

/* Auth is the seam between the landing and the admin: the landing's ground,
   the wordmark up top, the form sitting directly on it — no panel, a narrow
   centred column (the Linear-style auth composition). Pages render only
   their content; this shell owns the composition. The language is detected
   (cookie → browser), never picked here: when the browser put the page in a
   language other than English, a bar at the top offers English once. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <NextIntlClientProvider>
      <main lang={locale} className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 p-6">
        <LocaleNotice />
        <Link
          href="/"
          className="text-foreground focus-visible:ring-ring focus-visible:ring-offset-background rounded-sm text-[23px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
        >
          <BookloWordmark />
        </Link>
        <div className="w-full max-w-[340px]">{children}</div>
      </main>
    </NextIntlClientProvider>
  );
}
