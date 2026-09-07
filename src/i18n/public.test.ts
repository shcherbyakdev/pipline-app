import { describe, it, expect } from "vitest";
import { langFromPath, langHref, langParam, resolvePublicLocale, withLang } from "./public";

describe("resolvePublicLocale (spec §4 + region detection)", () => {
  it("an explicit valid ?lang wins over everything", () => {
    expect(resolvePublicLocale({ lang: "en", country: "UA", orgLocale: "uk" })).toBe("en");
    expect(resolvePublicLocale({ lang: "uk", country: "PL", orgLocale: "en" })).toBe("uk");
  });

  it("an invalid ?lang is ignored", () => {
    expect(resolvePublicLocale({ lang: "ua", country: null, orgLocale: "en" })).toBe("en");
    expect(resolvePublicLocale({ lang: ["uk"], country: null, orgLocale: "en" })).toBe("en");
    expect(resolvePublicLocale({ lang: "", country: null, orgLocale: "uk" })).toBe("uk");
  });

  it("a visitor from Ukraine gets Ukrainian whatever the org chose", () => {
    expect(resolvePublicLocale({ lang: undefined, country: "UA", orgLocale: "en" })).toBe("uk");
    expect(resolvePublicLocale({ lang: undefined, country: "ua", orgLocale: "en" })).toBe("uk");
  });

  it("a visitor from Poland gets Polish whatever the org chose", () => {
    expect(resolvePublicLocale({ lang: undefined, country: "PL", orgLocale: "en" })).toBe("pl");
    expect(resolvePublicLocale({ lang: undefined, country: "PL", orgLocale: "uk" })).toBe("pl");
  });

  it("no country ever overrides the org towards English", () => {
    expect(resolvePublicLocale({ lang: undefined, country: "US", orgLocale: "uk" })).toBe("uk");
    expect(resolvePublicLocale({ lang: undefined, country: "DE", orgLocale: "uk" })).toBe("uk");
    expect(resolvePublicLocale({ lang: undefined, country: "GB", orgLocale: "en" })).toBe("en");
  });

  it("falls back to the org locale, then English", () => {
    expect(resolvePublicLocale({ lang: undefined, country: null, orgLocale: "uk" })).toBe("uk");
    expect(resolvePublicLocale({ lang: undefined, country: undefined, orgLocale: "en" })).toBe("en");
    expect(resolvePublicLocale({ lang: undefined, country: null, orgLocale: "xx" })).toBe("en");
    expect(resolvePublicLocale({ lang: undefined, country: null, orgLocale: null })).toBe("en");
  });
});

describe("lang helpers", () => {
  it("langParam takes the first of a repeated query", () => {
    expect(langParam({ lang: ["uk", "en"] })).toBe("uk");
    expect(langParam({ lang: "en" })).toBe("en");
    expect(langParam({})).toBeUndefined();
    expect(langParam(null)).toBeUndefined();
  });

  it("langFromPath reads ?lang off the proxy's x-pathname", () => {
    expect(langFromPath("/anna?service=x&lang=uk")).toBe("uk");
    expect(langFromPath("/anna")).toBeUndefined();
    expect(langFromPath(null)).toBeUndefined();
    expect(langFromPath("/anna?x=1")).toBeUndefined();
  });

  it("withLang carries only a valid explicit override", () => {
    expect(withLang("/anna/spaces", "uk")).toBe("/anna/spaces?lang=uk");
    expect(withLang("/anna/spaces?space=1", "uk")).toBe("/anna/spaces?space=1&lang=uk");
    expect(withLang("/anna", undefined)).toBe("/anna");
    expect(withLang("/anna", "ua")).toBe("/anna");
  });
});

describe("langHref (the visitor's language links)", () => {
  it("sets ?lang on the current path", () => {
    expect(langHref("/anna", "uk")).toBe("/anna?lang=uk");
    expect(langHref("/anna/spaces", "en")).toBe("/anna/spaces?lang=en");
  });

  it("replaces a lang already on the URL and keeps the rest", () => {
    expect(langHref("/anna?service=abc&lang=uk", "en")).toBe("/anna?service=abc&lang=en");
    expect(langHref("/anna?lang=uk", "uk")).toBe("/anna?lang=uk");
  });

  it("falls back to a bare query when the proxy sent no path", () => {
    expect(langHref(null, "uk")).toBe("?lang=uk");
    expect(langHref(undefined, "en")).toBe("?lang=en");
  });
});
