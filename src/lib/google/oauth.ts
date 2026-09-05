import { createHmac, timingSafeEqual } from "node:crypto";

/* Google OAuth 2.0 for the calendar connection (spec 2026-09-05 §2.8, §5).
   Plain REST over fetch — the two token calls and one URL do not justify
   a client library. Config is passed in (features/calendar-sync builds it
   from env) so this file has no env read and the tests inject everything. */

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  /** Consent page host: https://accounts.google.com, or the local fake. */
  oauthBase: string;
  /** Token endpoint host: https://oauth2.googleapis.com, or the local fake. */
  tokenBase: string;
  /** HMAC key for the state parameter (the sealing key doubles for it). */
  stateKey: string;
};

export const SCOPES = [
  // Read and write events on any calendar the account can see.
  "https://www.googleapis.com/auth/calendar.events",
  // The calendar picker. No userinfo scope: the primary calendar's id is
  // the account email.
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

/** Google's OAuth error codes we act on. `invalid_grant` = the refresh
    token is dead (revoked in Google, password changed, six months unused
    on an unverified app): the connection needs a reconnect. */
export class GoogleAuthError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "GoogleAuthError";
  }
}

export type StatePayload = { orgId: string; userId: string; staffId: string | null; nonce: string };
const STATE_TTL_MS = 10 * 60_000;

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

/** `<base64url json>.<hmac>`; the json carries an absolute expiry. */
export function signState(payload: StatePayload, cfg: OAuthConfig, now = new Date()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now.getTime() + STATE_TTL_MS })).toString("base64url");
  return `${body}.${sign(body, cfg.stateKey)}`;
}

export function verifyState(state: string, cfg: OAuthConfig, now = new Date()): StatePayload | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, cfg.stateKey);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload & { exp: number };
    if (typeof parsed.exp !== "number" || parsed.exp < now.getTime()) return null;
    const { orgId, userId, staffId, nonce } = parsed;
    if (typeof orgId !== "string" || typeof userId !== "string" || typeof nonce !== "string") return null;
    return { orgId, userId, staffId: typeof staffId === "string" ? staffId : null, nonce };
  } catch {
    return null;
  }
}

export function authUrl(state: string, redirectUri: string, cfg: OAuthConfig): string {
  const u = new URL("/o/oauth2/v2/auth", cfg.oauthBase);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  // offline = a refresh token; consent = one on EVERY connect, not only the
  // first (a reconnect after revocation must get a fresh one).
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  params: Record<string, string>,
  cfg: OAuthConfig,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(new URL("/token", cfg.tokenBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) throw new GoogleAuthError(json.error ?? `http_${res.status}`, json.error_description);
  return json;
}

function expiry(expiresIn: number | undefined, now: Date): Date {
  // A minute of slack so a token that is about to expire is never used.
  return new Date(now.getTime() + Math.max(0, (expiresIn ?? 3600) - 60) * 1000);
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  cfg: OAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, cfg, fetchImpl);
  if (!t.access_token || !t.refresh_token) throw new GoogleAuthError("no_refresh_token");
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiry(t.expires_in, now) };
}

export async function refreshAccessToken(
  refreshToken: string,
  cfg: OAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ accessToken: string; expiresAt: Date }> {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, cfg, fetchImpl);
  if (!t.access_token) throw new GoogleAuthError("no_access_token");
  return { accessToken: t.access_token, expiresAt: expiry(t.expires_in, now) };
}
