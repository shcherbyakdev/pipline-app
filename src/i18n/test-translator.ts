import { createTranslator } from "next-intl";
import type { Messages, NamespaceKeys, NestedKeyOf } from "use-intl/core";
import en from "../../messages/en.json";

/** Test-only: the English translator for one namespace, so a pure helper's
    unit test can call it the way a component does. */
export function enTranslator<NS extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(namespace: NS) {
  return createTranslator({ locale: "en", messages: en, namespace });
}
