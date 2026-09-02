import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, INTL_LOCALES, isLocale, type Locale } from "./config";
import { loadMessages } from "./messages";
import type { Translator } from "./translator";

export type EmailsT = Translator<"emails">;

/** Everything a mail builder needs in the ORG's language (spec D4: every
    mail the org sends follows orgs.locale — never the visitor's region or
    ?lang=). Built with createTranslator, not getTranslations, so it works
    wherever a mail is sent: server actions, the reminder drain's route
    handler, scripts and tests alike — no request context needed. */
export async function emailTranslators(orgLocale: string | null | undefined): Promise<{
  locale: Locale;
  intlLocale: string;
  t: EmailsT;
  tUnits: Translator<"public.units">;
}> {
  const locale = isLocale(orgLocale) ? orgLocale : DEFAULT_LOCALE;
  const messages = await messagesOrFallback(locale);
  return {
    locale,
    intlLocale: INTL_LOCALES[locale],
    t: createTranslator({ locale, messages, namespace: "emails" }),
    tUnits: createTranslator({ locale, messages, namespace: "public.units" }),
  };
}

// Never rejects: the send sites call this after the booking is committed,
// inside regions where "nothing may fail the action" (a mail failure must
// not report a booked slot as lost). A chunk that fails to load on a cold
// instance degrades to English, then to key paths — bad copy, never a
// duplicate booking.
async function messagesOrFallback(locale: Locale) {
  try {
    return await loadMessages(locale);
  } catch (error) {
    console.error("[i18n] email messages failed to load:", error);
    try {
      return await loadMessages(DEFAULT_LOCALE);
    } catch {
      return {};
    }
  }
}
