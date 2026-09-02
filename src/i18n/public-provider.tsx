import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { getMessages } from "next-intl/server";
import type { Locale } from "./config";

// What the public client bundle carries (spec §4): the widget's own
// strings, the action errors, the shared words — never the admin's.
const PUBLIC_NAMESPACES = ["public", "errors", "common"] as const;

/** The public namespaces out of a full message set — for PublicIntl here
    and for the studio preview, which renders in the org's language inside
    the admin's tree. */
export function publicMessages(all: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(PUBLIC_NAMESPACES.map((ns) => [ns, all[ns]]));
}

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
  const messages = publicMessages(await getMessages());
  return (
    <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
      <div lang={locale} className="contents">
        {children}
      </div>
    </NextIntlClientProvider>
  );
}
