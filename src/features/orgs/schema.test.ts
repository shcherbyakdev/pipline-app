import { describe, it, expect } from "vitest";
import { createOrgSchema } from "./schema";

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
