import { describe, it, expect } from "vitest";
import { orgSearchInput } from "./schema";

describe("orgSearchInput", () => {
  it("strips characters that would corrupt a PostgREST .or() ilike pattern", () => {
    // ' ( ) , % all removed — apostrophe, parens, comma and percent are not
    // in the allow-list (letters, digits, space, ._-), so an org name like
    // this can never break out of the ilike/.or() pattern it feeds.
    expect(orgSearchInput.parse({ q: "Joe's Salon (Downtown), 50%" })).toEqual({
      q: "Joes Salon Downtown 50",
    });
  });
  it("keeps letters, digits, space, dot, underscore and dash untouched", () => {
    expect(orgSearchInput.parse({ q: "Acme-Corp_2.0 test" })).toEqual({ q: "Acme-Corp_2.0 test" });
  });
  it("truncates past 80 characters instead of throwing", () => {
    // The owner can hand-edit `?q=` — an over-long value is answered with the
    // first 80 characters' matches, not with a ZodError rendered as a 500.
    const long = "a".repeat(100);
    expect(orgSearchInput.parse({ q: long })).toEqual({ q: "a".repeat(80) });
    // The cap runs before the strip, so the bound holds on what reaches
    // Postgres even when the tail is all droppable characters.
    expect(orgSearchInput.parse({ q: `${"b".repeat(81)}%%%` }).q).toHaveLength(80);
  });
  it("trims surrounding whitespace and passes an empty string through", () => {
    expect(orgSearchInput.parse({ q: "  " })).toEqual({ q: "" });
    expect(orgSearchInput.parse({ q: "" })).toEqual({ q: "" });
  });
});
