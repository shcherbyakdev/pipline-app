import { describe, it, expect } from "vitest";
import { parseInternalEmails, isInternalEmail } from "./allowlist";

describe("parseInternalEmails", () => {
  it("splits on commas, trims, lower-cases, drops empties", () => {
    const set = parseInternalEmails(" Owner@Example.com , ,second@example.com,");
    expect([...set]).toEqual(["owner@example.com", "second@example.com"]);
  });
  it("undefined / empty → nobody", () => {
    expect(parseInternalEmails(undefined).size).toBe(0);
    expect(parseInternalEmails("").size).toBe(0);
    expect(parseInternalEmails(" , ").size).toBe(0);
  });
});

describe("isInternalEmail", () => {
  const allow = parseInternalEmails("owner@example.com");
  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isInternalEmail("OWNER@example.com", allow)).toBe(true);
    expect(isInternalEmail("  owner@example.com ", allow)).toBe(true);
  });
  it("rejects strangers, null and undefined", () => {
    expect(isInternalEmail("stranger@example.com", allow)).toBe(false);
    expect(isInternalEmail(null, allow)).toBe(false);
    expect(isInternalEmail(undefined, allow)).toBe(false);
  });
  it("an empty allowlist admits nobody, not even an empty email", () => {
    expect(isInternalEmail("", new Set())).toBe(false);
    expect(isInternalEmail("owner@example.com", new Set())).toBe(false);
  });
});
