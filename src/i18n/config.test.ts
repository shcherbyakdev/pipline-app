import { describe, it, expect } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, isLocale, negotiateLocale } from "./config";

describe("locale config", () => {
  it("names every locale in itself", () => {
    for (const l of LOCALES) expect(LOCALE_NAMES[l]).toBeTruthy();
    expect(LOCALE_NAMES.uk).toBe("Українська");
    expect(LOCALE_NAMES.pl).toBe("Polski");
  });

  it("isLocale accepts only listed codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("uk")).toBe(true);
    for (const bad of ["ua", "UK", "en-GB", "", null, undefined, 1]) expect(isLocale(bad)).toBe(false);
  });

  it("negotiateLocale picks the best supported language by q-value, base language only", () => {
    expect(negotiateLocale("uk-UA,uk;q=0.9,en;q=0.8")).toBe("uk");
    expect(negotiateLocale("en-US,en;q=0.9,uk;q=0.8")).toBe("en");
    expect(negotiateLocale("uk;q=0.5,en;q=0.9")).toBe("en");
    expect(negotiateLocale("UK-ua")).toBe("uk");
  });

  it("negotiateLocale falls back to the default on unknown, empty, wildcard or zero-weight input", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("*")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("ru,de;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("uk;q=0")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("uk;q=abc")).toBe(DEFAULT_LOCALE);
  });
});
