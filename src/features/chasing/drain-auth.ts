import { createHash, timingSafeEqual } from "node:crypto";

// Hash both sides to fixed length so timingSafeEqual is usable regardless
// of attacker-controlled input length. No secret configured = fail closed.
export function isAuthorizedDrainRequest(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = createHash("sha256").update(header.slice(7), "utf8").digest();
  const expected = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(provided, expected);
}
