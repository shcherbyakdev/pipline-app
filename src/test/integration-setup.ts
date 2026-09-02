import { vi } from "vitest";

// The public server actions resolve their error copy through next-intl's
// request-scoped `getTranslations` (src/i18n/public.ts), which only exists
// inside a Next request. Under Vitest there is none, so every integration
// file gets the English translator instead — the same messages/en.json the
// app ships, so the assertions read the exact copy a visitor would.
vi.mock("next-intl/server", async () => {
  const { enTranslator } = await import("@/i18n/test-translator");
  return {
    getLocale: async () => "en",
    getTranslations: async (opts?: { namespace?: string } | string) => {
      const namespace = typeof opts === "string" ? opts : opts?.namespace;
      return enTranslator(namespace as never);
    },
    setRequestLocale: () => {},
  };
});
