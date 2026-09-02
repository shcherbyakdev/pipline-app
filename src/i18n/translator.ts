import type { createTranslator, Messages, NamespaceKeys, NestedKeyOf } from "use-intl/core";

/** A translator bound to one namespace — what a pure helper accepts so a
    client component (`useTranslations`), a server component or action
    (`getTranslations`) and a test (`createTranslator`) can all hand one in.
    `use-intl/core` is next-intl's own core; the type is not re-exported. */
export type Translator<NS extends NamespaceKeys<Messages, NestedKeyOf<Messages>>> = ReturnType<
  typeof createTranslator<Messages, NS>
>;

/** The words every price, duration and stay helper needs (`public.units`):
    "120 zł / hour", "3 nights", "1 h 30 min", "Total: …". One namespace so a
    caller hands in one translator. */
export type UnitsT = Translator<"public.units">;
