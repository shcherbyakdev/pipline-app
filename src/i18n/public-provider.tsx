import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { Locale } from "./config";

// What the public client bundle carries (spec §4): the widget's own
// strings, the action errors, the shared words — never the admin's.
const PUBLIC_NAMESPACES = ["public", "errors", "common"] as const;

/** The public surfaces' provider. The page has already called
    setRequestLocale(locale) — getMessages() reads that locale's messages —
    and `lang` on the wrapper scopes the language for assistive tech on this
    subtree while the root <html lang> stays the interface locale (spec §3). */
export async function PublicIntl({
  locale,
  timeZone,
  children,
}: {
  locale: Locale;
  timeZone: string;
  children: React.ReactNode;
}) {
  const all = await getMessages();
  const messages = Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, all[ns]]));
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
      <div lang={locale} className="contents">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
