import { describe, it, expect, beforeEach, vi } from "vitest";

/* Pins the show rule: a negotiated (cookie-less) non-default language gets
   the bar; the default language and an answered notice do not. */
const state = vi.hoisted(() => ({ locale: "en", hasCookie: false }));

vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => state.hasCookie }) }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async () => (key: string) => key,
}));
vi.mock("./actions", () => ({ setLocale: vi.fn() }));
// locale-notice.tsx -> ./cookie -> @/env, which validates real env vars at module load.
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));

import { LocaleNotice } from "./locale-notice";

beforeEach(() => {
  state.locale = "en";
  state.hasCookie = false;
});

describe("LocaleNotice", () => {
  it("stays hidden in the default language", async () => {
    expect(await LocaleNotice()).toBeNull();
  });

  it("stays hidden once the person has answered (cookie present)", async () => {
    state.locale = "uk";
    state.hasCookie = true;
    expect(await LocaleNotice()).toBeNull();
  });

  it("offers English, in English, when Ukrainian was negotiated from the browser", async () => {
    state.locale = "uk";
    const bar = await LocaleNotice();
    expect(bar).not.toBeNull();
    expect(JSON.stringify(bar)).toContain("Switch to English");
  });
});
