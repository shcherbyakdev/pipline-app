import { describe, it, expect } from "vitest";
import { isAllowedLogoType, logoPathFor, LOGO_MAX_BYTES } from "./logo";

describe("logo helpers", () => {
  it("allows png/jpeg/webp and rejects svg (scriptable on a public bucket)", () => {
    expect(isAllowedLogoType("image/png")).toBe(true);
    expect(isAllowedLogoType("image/jpeg")).toBe(true);
    expect(isAllowedLogoType("image/webp")).toBe(true);
    expect(isAllowedLogoType("image/svg+xml")).toBe(false);
    expect(isAllowedLogoType("image/heic")).toBe(false);
  });

  it("builds org-prefixed content-hashed paths; null for disallowed mime", () => {
    expect(logoPathFor("org-1", "abc123", "image/png")).toBe("org-1/logo-abc123.png");
    expect(logoPathFor("org-1", "abc123", "image/svg+xml")).toBeNull();
  });

  it("caps at 1 MB", () => {
    expect(LOGO_MAX_BYTES).toBe(1_048_576);
  });
});
