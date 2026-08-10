import { describe, it, expect } from "vitest";
import {
  PHOTO_MAX_BYTES,
  isAllowedPhotoType,
  evidencePathFor,
} from "./photo";

describe("photo helpers", () => {
  it("accepts the allowlist, rejects everything else", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
      expect(isAllowedPhotoType(m)).toBe(true);
    }
    expect(isAllowedPhotoType("application/pdf")).toBe(false);
    expect(isAllowedPhotoType("image/svg+xml")).toBe(false); // scriptable — never
    expect(isAllowedPhotoType("")).toBe(false);
  });

  it("caps at exactly 15MB", () => {
    expect(PHOTO_MAX_BYTES).toBe(15728640);
  });

  it("builds org/program/unit-prefixed paths with the mime's extension", () => {
    expect(evidencePathFor("org", "prog", "unit", "obj", "image/jpeg")).toBe(
      "org/prog/unit/obj.jpg",
    );
    expect(evidencePathFor("org", "prog", "unit", "obj", "image/heic")).toBe(
      "org/prog/unit/obj.heic",
    );
    expect(evidencePathFor("org", "prog", "unit", "obj", "text/html")).toBeNull();
  });
});
