import { createHash, randomBytes } from "node:crypto";

// 32 random bytes = 256 bits. This IS the security boundary for /p — the
// RPCs are anon-callable, so guessing must be physically infeasible.
// Never shorten. Hashing must agree with SQL:
//   encode(extensions.digest(convert_to(token,'utf8'),'sha256'),'hex')
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateParticipantToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
