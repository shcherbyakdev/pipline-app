import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LOCALES, LOCALE_NAMES, type Locale } from "./config";
import { langHref } from "./public-locale";

/* The visitor's way out of a language they cannot read (spec §4, amended
   2026-09-03). The org picks the language its page speaks and the region
   handles the common case; this is the escape hatch, so it sits in the
   page footer rather than fighting the builder's own layout.

   Plain links, no client state: `?lang=` is already the public override and
   `withLang` carries it through the cross-links, the manage link and back
   into the server actions — so the choice survives the whole booking with
   nothing to hydrate and nothing to store. LOCALE_NAMES is each language
   named in itself: the label must be readable by someone who cannot read
   the page it is on. */
export async function PublicLanguageLinks({ locale }: { locale: Locale }) {
  const [h, t] = await Promise.all([headers(), getTranslations("public")]);
  // pathname + search, stamped by the proxy (lib/supabase/middleware.ts).
  const path = h.get("x-pathname");
  return (
    <nav aria-label={t("language")} className="mt-3 flex items-center justify-center gap-3 text-xs opacity-60">
      {LOCALES.map((l) =>
        l === locale ? (
          <span key={l} aria-current="true" className="font-medium">
            {LOCALE_NAMES[l]}
          </span>
        ) : (
          <a key={l} href={langHref(path, l)} hrefLang={l} className="underline underline-offset-2">
            {LOCALE_NAMES[l]}
          </a>
        ),
      )}
    </nav>
  );
}
