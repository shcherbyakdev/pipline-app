import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/* Sealing for the Google tokens at rest (spec 2026-09-05 §2.7). AES-256-GCM
   from node:crypto — nothing to install, authenticated (a flipped byte
   fails to open rather than decrypting to garbage). The blob is
   `v1.<iv>.<tag>.<ciphertext>` in base64url so a later scheme can sit
   beside it. The key is GCAL_TOKEN_KEY: 32 random bytes, base64. Callers
   pass the key explicitly so the module has no env read and tests need no
   stubbing; features/calendar-sync/connections.ts supplies env's. */

function keyBytes(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("GCAL_TOKEN_KEY must be 32 bytes (base64)");
  return key;
}

export function seal(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function open(sealed: string, keyB64: string): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised sealed blob");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyB64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
