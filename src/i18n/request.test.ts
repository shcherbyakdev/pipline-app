import { describe, it, expect, beforeEach, vi } from "vitest";

/* Pins the resolution order (spec §4): explicit requestLocale → cookie →
   Accept-Language → en. next-intl's getRequestConfig(fn) just returns fn, so
   mocking it as the identity makes the default export directly callable. */

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
const acceptLanguage = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && cookieValue.value !== undefined ? { name, value: cookieValue.value } : undefined,
  }),
  headers: async () => ({ get: (name: string) => (name === "accept-language" ? acceptLanguage.value : null) }),
}));

vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("./messages", () => ({ loadMessages: async (locale: string) => ({ probe: locale }) }));
// request.ts -> ./cookie -> @/env, which validates real env vars at module load.
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));

import config from "./request";

type Resolved = { locale: string; messages: { probe: string } };
const resolve = config as unknown as (args: { requestLocale: Promise<string | undefined> }) => Promise<Resolved>;

beforeEach(() => {
  cookieValue.value = undefined;
  acceptLanguage.value = null;
});

describe("request config resolution order", () => {
  it("an explicit locale wins over the cookie", async () => {
    cookieValue.value = "en";
    const { locale, messages } = await resolve({ requestLocale: Promise.resolve("uk") });
    expect(locale).toBe("uk");
    expect(messages.probe).toBe("uk");
  });

  it("an invalid explicit locale is ignored and the cookie wins", async () => {
    cookieValue.value = "uk";
    const { locale, messages } = await resolve({ requestLocale: Promise.resolve("ua") });
    expect(locale).toBe("uk");
    expect(messages.probe).toBe("uk");
  });

  it("falls back to Accept-Language with no explicit locale and no cookie", async () => {
    acceptLanguage.value = "uk-UA,uk;q=0.9,en;q=0.5";
    const { locale, messages } = await resolve({ requestLocale: Promise.resolve(undefined) });
    expect(locale).toBe("uk");
    expect(messages.probe).toBe("uk");
  });

  it("defaults to en when nothing resolves", async () => {
    const { locale, messages } = await resolve({ requestLocale: Promise.resolve(undefined) });
    expect(locale).toBe("en");
    expect(messages.probe).toBe("en");
  });

  it("an invalid cookie falls through to Accept-Language", async () => {
    cookieValue.value = "xx";
    acceptLanguage.value = "uk-UA,uk;q=0.9,en;q=0.5";
    const { locale, messages } = await resolve({ requestLocale: Promise.resolve(undefined) });
    expect(locale).toBe("uk");
    expect(messages.probe).toBe("uk");
  });
});
