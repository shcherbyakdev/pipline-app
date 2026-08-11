import { describe, it, expect } from "vitest";
import { isAllowedLogoType, logoPathFor, matchesLogoMagicBytes, LOGO_MAX_BYTES } from "./logo";

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

describe("matchesLogoMagicBytes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);
  // SVG bytes ("<svg ...") — the reviewer's repro of a scriptable file
  // uploading successfully once it's merely declared as image/png.
  const svgAsBytes = new TextEncoder().encode("<svg xmlns='x'></svg>");

  it("accepts real bytes that match their declared MIME", () => {
    expect(matchesLogoMagicBytes(png, "image/png")).toBe(true);
    expect(matchesLogoMagicBytes(jpeg, "image/jpeg")).toBe(true);
    expect(matchesLogoMagicBytes(webp, "image/webp")).toBe(true);
  });

  it("rejects SVG bytes relabeled as an allowed MIME", () => {
    expect(matchesLogoMagicBytes(svgAsBytes, "image/png")).toBe(false);
    expect(matchesLogoMagicBytes(svgAsBytes, "image/jpeg")).toBe(false);
    expect(matchesLogoMagicBytes(svgAsBytes, "image/webp")).toBe(false);
  });

  it("rejects bytes that don't agree with the declared MIME, even if valid for another allowed format", () => {
    expect(matchesLogoMagicBytes(png, "image/jpeg")).toBe(false);
    expect(matchesLogoMagicBytes(jpeg, "image/png")).toBe(false);
    expect(matchesLogoMagicBytes(webp, "image/png")).toBe(false);
  });

  it("rejects a disallowed declared MIME outright", () => {
    expect(matchesLogoMagicBytes(png, "image/svg+xml")).toBe(false);
  });

  it("rejects truncated bytes shorter than the magic number", () => {
    expect(matchesLogoMagicBytes(new Uint8Array([0x89, 0x50]), "image/png")).toBe(false);
    expect(matchesLogoMagicBytes(new Uint8Array(0), "image/jpeg")).toBe(false);
  });
});
