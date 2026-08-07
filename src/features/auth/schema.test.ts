import { describe, it, expect } from "vitest";
import { emailSchema } from "./schema";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
  it("rejects a malformed email", () => {
    expect(emailSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
