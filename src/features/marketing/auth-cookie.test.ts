import { describe, it, expect } from "vitest";
import { hasAuthCookie } from "./auth-cookie";

// The nav swaps Log in / Get started for Dashboard on the presence of the
// @supabase/ssr session cookie (sb-<ref>-auth-token, possibly chunked).
// Presence is a hint, not proof — a stale cookie just bounces at /login.
describe("hasAuthCookie", () => {
  it("is false with no cookies", () => {
    expect(hasAuthCookie("")).toBe(false);
  });

  it("is false with unrelated cookies", () => {
    expect(hasAuthCookie("booklo_recovery=1; theme=dark")).toBe(false);
  });

  it("finds the session cookie", () => {
    expect(hasAuthCookie("theme=dark; sb-abcdefgh-auth-token=base64-eyJ")).toBe(true);
  });

  it("finds a chunked session cookie", () => {
    expect(hasAuthCookie("sb-abcdefgh-auth-token.0=eyJ; sb-abcdefgh-auth-token.1=fgh")).toBe(true);
  });

  it("ignores the PKCE code-verifier cookie (set before login completes)", () => {
    expect(hasAuthCookie("sb-abcdefgh-auth-token-code-verifier=xyz")).toBe(false);
  });

  it("matches cookie names, not values", () => {
    expect(hasAuthCookie("evil=sb-abcdefgh-auth-token")).toBe(false);
  });
});
