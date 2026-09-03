import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { setLocale } from "./actions";
import { DEFAULT_LOCALE, SWITCH_TO_LOCALE } from "./config";
import { LOCALE_COOKIE } from "./cookie";

/* The pre-login language control (ruling 2026-09-03: the switcher itself
   lives in Settings only). Shown when the interface language was picked FOR
   the person — no cookie, so request.ts negotiated it from Accept-Language —
   and it is not the default: one bar at the top, in that language, with the
   way back to English written in English (whoever landed here through a
   shared browser must be able to read the way out). Both answers go through
   setLocale, so the cookie exists afterwards and the bar never returns on
   this device — nor on the next once signed in (user_metadata). Plain form
   actions: works before hydration and without JS. */
export async function LocaleNotice() {
  const locale = await getLocale();
  if (locale === DEFAULT_LOCALE || (await cookies()).has(LOCALE_COOKIE)) return null;
  const t = await getTranslations("common");
  return (
    <form
      role="region"
      aria-label={t("language")}
      className="animate-fade-up bg-card fixed inset-x-4 top-4 z-40 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center"
    >
      <p className="text-foreground/80 flex-1 text-sm">{t("localeNotice.body")}</p>
      <div className="flex gap-2 self-end sm:self-auto">
        <button type="submit" formAction={setLocale.bind(null, locale)} className={buttonVariants({ variant: "outline" })}>
          {t("localeNotice.keep")}
        </button>
        <button
          type="submit"
          lang={DEFAULT_LOCALE}
          formAction={setLocale.bind(null, DEFAULT_LOCALE)}
          className={buttonVariants()}
        >
          {SWITCH_TO_LOCALE[DEFAULT_LOCALE]}
        </button>
      </div>
    </form>
  );
}
