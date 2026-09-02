import { describe, it, expect } from "vitest";
import {
  emailSchema,
  signInSchema,
  signUpSchema,
  newPasswordSchema,
} from "./schema";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
  it("rejects a malformed email", () => {
    expect(emailSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid email with any non-empty password", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "short1" }).success,
    ).toBe(true);
  });
  it("rejects an empty password", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "" }).success,
    ).toBe(false);
  });
  it("rejects a malformed email", () => {
    expect(
      signInSchema.safeParse({ email: "nope", password: "whatever1" }).success,
    ).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.com", password: "1234567" }).success,
    ).toBe(false);
  });
  it("accepts passwords of 8+ characters", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.com", password: "12345678" })
        .success,
    ).toBe(true);
  });
});

describe("signUpSchema handle", () => {
  const base = { email: "a@b.com", password: "longenough" };
  it("accepts a well-formed handle", () => {
    expect(signUpSchema.parse({ ...base, handle: "anna-studio" }).handle).toBe("anna-studio");
  });
  it("treats an empty string as absent", () => {
    expect(signUpSchema.parse({ ...base, handle: "" }).handle).toBeUndefined();
    expect(signUpSchema.parse(base).handle).toBeUndefined();
  });
  it("rejects malformed and reserved handles", () => {
    expect(signUpSchema.safeParse({ ...base, handle: "Ab" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, handle: "login" }).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("rejects a mismatched confirmation", () => {
    const result = newPasswordSchema.safeParse({
      password: "12345678",
      confirm: "12345679",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("errors.passwordsMismatch");
    }
  });
  it("rejects passwords shorter than 8 characters even when matching", () => {
    expect(
      newPasswordSchema.safeParse({ password: "1234567", confirm: "1234567" })
        .success,
    ).toBe(false);
  });
  it("accepts a matching 8+ character pair", () => {
    expect(
      newPasswordSchema.safeParse({ password: "12345678", confirm: "12345678" })
        .success,
    ).toBe(true);
  });
});

