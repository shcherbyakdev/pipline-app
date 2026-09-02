import { createTranslator } from "next-intl";
import type { Messages, NamespaceKeys, NestedKeyOf } from "use-intl/core";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { deepMerge } from "./messages";
import type { Locale } from "./config";

type NS = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

/** Test-only: the shipped messages for a locale (English underneath, as
    loadMessages does) — what a mock of next-intl/server hands back. */
export function messagesFor(locale: Locale) {
  return locale === "uk" ? (deepMerge(en, uk) as typeof en) : en;
}

/** Test-only: a translator for one namespace in one locale, so a pure
    helper's unit test can call it the way a component does. */
export function translatorFor<N extends NS>(locale: Locale, namespace: N) {
  return createTranslator({ locale, messages: messagesFor(locale), namespace });
}

export function enTranslator<N extends NS>(namespace: N) {
  return translatorFor("en", namespace);
}
