import type { AbstractIntlMessages } from "next-intl";
import { DEFAULT_LOCALE, type Locale } from "./config";

// One line per language (spec §10). Literal paths so the bundler splits them.
const LOADERS: Record<Locale, () => Promise<AbstractIntlMessages>> = {
  en: () => import("../../messages/en.json").then((m) => m.default),
  uk: () => import("../../messages/uk.json").then((m) => m.default),
  pl: () => import("../../messages/pl.json").then((m) => m.default),
};

export function deepMerge(base: AbstractIntlMessages, over: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const under = out[key];
    out[key] =
      value && typeof value === "object" && under && typeof under === "object"
        ? deepMerge(under, value)
        : value;
  }
  return out;
}

/** The locale's messages with English underneath (spec D8): a key missing
    from uk.json renders English, never a key path. messages.test.ts keeps
    that gap at zero; this is the safety net, not the workflow. */
export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const en = await LOADERS[DEFAULT_LOCALE]();
  if (locale === DEFAULT_LOCALE) return en;
  return deepMerge(en, await LOADERS[locale]());
}
