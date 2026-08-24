import { describe, it, expect } from "vitest";
import { grantOverrideInput, orgSearchInput, todayUtc } from "./schema";

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

describe("grantOverrideInput.expires", () => {
  const base = { org: "123e4567-e89b-12d3-a456-426614174000", plan: "pro", note: "" };
  const expiresIssue = (expires: string) => {
    const r = grantOverrideInput.safeParse({ ...base, expires });
    return r.success ? null : r.error.issues.find((i) => i.path[0] === "expires") ?? null;
  };

  it("accepts empty (no expiry), today and any later date", () => {
    expect(expiresIssue("")).toBeNull();
    // Same day is still ahead: the action turns it into end-of-day UTC.
    expect(expiresIssue(todayUtc())).toBeNull();
    expect(expiresIssue("2999-12-31")).toBeNull();
  });

  it("refuses a date already past, with its own line", () => {
    // Saving it would write a comp that is expired on arrival — the panel
    // would read "expired" and the owner would wonder whether the grant took.
    const yesterday = todayUtc(new Date(Date.now() - 864e5));
    expect(expiresIssue(yesterday)).toMatchObject({ code: "custom", message: "Expiry must be today or later." });
    expect(expiresIssue("2020-01-01")).toMatchObject({ code: "custom" });
  });

  it("still rejects a malformed date as a format error, not as 'past'", () => {
    expect(expiresIssue("31/12/2999")?.code).not.toBe("custom");
    expect(expiresIssue("31/12/2999")).not.toBeNull();
  });

  it("todayUtc is the UTC calendar day", () => {
    expect(todayUtc(new Date("2026-08-24T23:59:59Z"))).toBe("2026-08-24");
    expect(todayUtc(new Date("2026-08-25T00:00:00Z"))).toBe("2026-08-25");
  });
});
