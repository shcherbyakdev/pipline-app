import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, open } from "./crypto";

const key = randomBytes(32).toString("base64");
const other = randomBytes(32).toString("base64");

describe("seal / open", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const a = seal("1//refresh-token", key);
    const b = seal("1//refresh-token", key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(open(a, key)).toBe("1//refresh-token");
    expect(open(b, key)).toBe("1//refresh-token");
  });

  it("refuses a tampered blob and a wrong key", () => {
    const sealed = seal("secret", key);
    const [v, iv, tag, ct] = sealed.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() => open([v, iv, tag, flipped.toString("base64url")].join("."), key)).toThrow();
    expect(() => open(sealed, other)).toThrow();
    expect(() => open("v2.a.b.c", key)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => seal("x", "dG9vLXNob3J0")).toThrow(/32 bytes/);
  });
});
