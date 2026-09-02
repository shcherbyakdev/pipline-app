import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, negotiateLocale } from "./config";
import { LOCALE_COOKIE } from "./cookie";
import { loadMessages } from "./messages";

// Resolution order (spec §4): an explicit per-request locale (public surfaces
// call setRequestLocale(org.locale) — Wave 1) → the person's cookie → the
// browser's Accept-Language → English.
export default getRequestConfig(async ({ requestLocale }) => {
  const explicit = await requestLocale;
  let locale = isLocale(explicit) ? explicit : null;
  if (!locale) {
    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = isLocale(fromCookie) ? fromCookie : negotiateLocale((await headers()).get("accept-language"));
  }
  return { locale, messages: await loadMessages(locale) };
});
