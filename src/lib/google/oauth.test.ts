import { describe, it, expect } from "vitest";
import {
  authUrl,
  exchangeCode,
  refreshAccessToken,
  signState,
  verifyState,
  GoogleAuthError,
  type OAuthConfig,
} from "./oauth";

const cfg: OAuthConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  oauthBase: "https://accounts.google.com",
  tokenBase: "https://oauth2.googleapis.com",
  stateKey: "state-key",
};
const NOW = new Date("2026-09-05T10:00:00Z");
const payload = { orgId: "org-1", userId: "user-1", staffId: null, nonce: "n1" };

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; body: string }> = []) {
  const f: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { f, seen };
}

describe("state", () => {
  it("signs and verifies within the window; refuses expiry and tampering", () => {
    const s = signState(payload, cfg, NOW);
    expect(verifyState(s, cfg, new Date(NOW.getTime() + 5 * 60_000))).toMatchObject(payload);
    expect(verifyState(s, cfg, new Date(NOW.getTime() + 11 * 60_000))).toBeNull();
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, orgId: "org-2", exp: NOW.getTime() + 600_000 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, cfg, NOW)).toBeNull();
    expect(verifyState(`${body}.${sig}x`, cfg, NOW)).toBeNull();
    expect(verifyState("garbage", cfg, NOW)).toBeNull();
  });
});

describe("authUrl", () => {
  it("asks for offline access with consent, the two scopes and the state", () => {
    const u = new URL(authUrl("st", "https://app.test/api/google/callback", cfg));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.test/api/google/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("scope")!.split(" ")).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ]);
  });
});

describe("exchangeCode / refreshAccessToken", () => {
  it("exchanges a code for both tokens with an absolute expiry", async () => {
    const { f, seen } = fakeFetch(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const t = await exchangeCode("the-code", "https://app.test/cb", cfg, f, NOW);
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: new Date("2026-09-05T10:59:00Z") });
    expect(seen[0].url).toBe("https://oauth2.googleapis.com/token");
    const params = new URLSearchParams(seen[0].body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("the-code");
    expect(params.get("client_secret")).toBe("csecret");
  });

  it("refuses an exchange that returned no refresh token", async () => {
    const { f } = fakeFetch(200, { access_token: "at", expires_in: 3600 });
    await expect(exchangeCode("c", "https://app.test/cb", cfg, f, NOW)).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("refreshes, and surfaces invalid_grant as a typed error", async () => {
    const ok = fakeFetch(200, { access_token: "at2", expires_in: 1800 });
    expect(await refreshAccessToken("rt", cfg, ok.f, NOW)).toEqual({ accessToken: "at2", expiresAt: new Date("2026-09-05T10:29:00Z") });
    expect(new URLSearchParams(ok.seen[0].body).get("grant_type")).toBe("refresh_token");
    const bad = fakeFetch(400, { error: "invalid_grant", error_description: "Token has been revoked." });
    const err = await refreshAccessToken("rt", cfg, bad.f, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_grant");
  });
});
