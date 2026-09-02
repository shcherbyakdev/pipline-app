import { vi } from "vitest";

// The public server actions resolve their error copy through next-intl's
// request-scoped `getTranslations` (src/i18n/public.ts), which only exists
// inside a Next request. Under Vitest there is none, so every integration
// file gets the shipped messages instead — honouring an explicit `locale`
// option, so a wrong-language error is still catchable. Anything reaching
// for an API not stubbed here fails loudly rather than silently.
vi.mock("next-intl/server", async () => {
  const { isLocale } = await import("@/i18n/config");
  const { messagesFor, translatorFor } = await import("@/i18n/test-translator");
  const localeOf = (opts?: { locale?: string } | string) =>
    typeof opts === "object" && isLocale(opts?.locale) ? opts.locale : "en";
  return {
    getLocale: async () => "en",
    getMessages: async (opts?: { locale?: string }) => messagesFor(localeOf(opts)),
    getTranslations: async (opts?: { locale?: string; namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return translatorFor(localeOf(opts), namespace as never);
    },
    setRequestLocale: () => {},
  };
});
