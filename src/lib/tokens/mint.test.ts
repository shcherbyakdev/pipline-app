import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateParticipantToken, hashToken } from "./mint";

describe("generateParticipantToken", () => {
  it("produces 32 bytes of base64url with a matching sha256 hex hash", () => {
    const { token, tokenHash } = generateParticipantToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url, no padding
    expect(tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("hashToken matches a known sha256 vector (must agree with SQL's digest)", () => {
    // sha256("abc") — the canonical test vector; SQL side:
    // encode(extensions.digest(convert_to('abc','utf8'),'sha256'),'hex')
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("two mints never collide", () => {
    expect(generateParticipantToken().token).not.toBe(generateParticipantToken().token);
  });
});
