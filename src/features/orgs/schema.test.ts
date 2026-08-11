import { describe, it, expect } from "vitest";
import { createOrgSchema, updateAccentInput } from "./schema";

describe("createOrgSchema", () => {
  it("accepts a valid name", () => {
    expect(createOrgSchema.safeParse({ name: "Acme Signage" }).success).toBe(true);
  });
  it("rejects a name shorter than 2 chars", () => {
    expect(createOrgSchema.safeParse({ name: "A" }).success).toBe(false);
  });
  it("rejects a name longer than 80 chars", () => {
    expect(createOrgSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(createOrgSchema.safeParse({ name: "  Acme  " }).data?.name).toBe("Acme");
  });
});

describe("accent colour input", () => {
  it("normalises to lowercase and accepts null", () => {
    expect(updateAccentInput.parse({ accentColor: "#0F766E" }).accentColor).toBe("#0f766e");
    expect(updateAccentInput.parse({ accentColor: null }).accentColor).toBeNull();
  });
  it("rejects non-hex", () => {
    expect(updateAccentInput.safeParse({ accentColor: "teal" }).success).toBe(false);
    expect(updateAccentInput.safeParse({ accentColor: "#fff" }).success).toBe(false);
  });
});
