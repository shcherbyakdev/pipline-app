import { describe, it, expect } from "vitest";
import { beginConnect, completeConnect, connectionDefaults, type ConnectStore } from "./oauth-flow";
import { signState, type OAuthConfig } from "@/lib/google/oauth";
import type { CalendarInfo } from "@/lib/google/calendar";

const cfg: OAuthConfig = { clientId: "cid", clientSecret: "cs", oauthBase: "https://accounts.google.com", tokenBase: "https://oauth2.googleapis.com", stateKey: "k" };
const REDIRECT = "https://app.test/api/google/callback";
const NOW = new Date("2026-09-05T10:00:00Z");
const cals: CalendarInfo[] = [
  { id: "team@group.calendar.google.com", summary: "Team", primary: false, canWrite: false },
  { id: "me@example.com", summary: "Me", primary: true, canWrite: true },
];

const tokenFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });

function memoryStore(existing: Array<{ id: string; orgId: string; accountEmail: string; staffId: string | null }> = [], ctx = { offersAppointments: true, activeStaffIds: ["staff-1"] }) {
  const inserted: Parameters<ConnectStore["insert"]>[0][] = [];
  const reconnected: Array<{ id: string; calendars: number }> = [];
  const requeued: Array<string | null> = [];
  const store: ConnectStore = {
    orgContext: async () => ctx,
    findByEmail: async (orgId, email) => {
      const hit = existing.find((e) => e.orgId === orgId && e.accountEmail === email);
      return hit ? { id: hit.id, staffId: hit.staffId } : null;
    },
    insert: async (row) => { inserted.push(row); return "conn-new"; },
    reconnect: async (id, patch) => { reconnected.push({ id, calendars: patch.calendars.length }); },
    requeueScope: async (_orgId, staffId) => { requeued.push(staffId); },
  };
  return { store, inserted, reconnected, requeued };
}

describe("beginConnect", () => {
  it("returns Google's consent URL carrying a signed state, and the nonce to cookie", () => {
    const { url, nonce } = beginConnect({ orgId: "org-1", userId: "user-1", staffId: null }, cfg, REDIRECT, NOW);
    const u = new URL(url);
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(nonce.length).toBeGreaterThan(10);
    expect(u.searchParams.get("state")).toContain(".");
  });
});

describe("connectionDefaults", () => {
  it("primary calendar = the account, the destination and the only busy source", () => {
    expect(connectionDefaults(cals, { requestedStaffId: null, offersAppointments: false, activeStaffIds: ["s"] })).toEqual({
      staffId: null, accountEmail: "me@example.com", pushCalendarId: "me@example.com", busyCalendarIds: ["me@example.com"],
    });
  });
  it("belongs to the only active person of an appointments org, else shared, unless asked for someone", () => {
    const solo = { requestedStaffId: null, offersAppointments: true, activeStaffIds: ["s1"] };
    expect(connectionDefaults(cals, solo)?.staffId).toBe("s1");
    expect(connectionDefaults(cals, { ...solo, activeStaffIds: ["s1", "s2"] })?.staffId).toBeNull();
    expect(connectionDefaults(cals, { ...solo, offersAppointments: false })?.staffId).toBeNull();
    expect(connectionDefaults(cals, { ...solo, requestedStaffId: "s2" })?.staffId).toBe("s2");
  });
  it("no calendars → nothing to connect", () => {
    expect(connectionDefaults([], { requestedStaffId: null, offersAppointments: true, activeStaffIds: [] })).toBeNull();
  });
});

describe("completeConnect", () => {
  const state = (nonce: string, staffId: string | null = null) => signState({ orgId: "org-1", userId: "user-1", staffId, nonce }, cfg, NOW);
  const expected = { orgId: "org-1", userId: "user-1" };

  it("refuses a missing, expired, tampered or nonce-mismatched state", async () => {
    const m = memoryStore();
    const deps = { cfg, redirectUri: REDIRECT, store: m.store, listCalendars: async () => cals, fetchImpl: tokenFetch, now: NOW };
    expect(await completeConnect({ state: null, code: "c", cookieNonce: "n", expected }, deps)).toEqual({ ok: false, reason: "state" });
    expect(await completeConnect({ state: state("n"), code: "c", cookieNonce: "other", expected }, deps)).toEqual({ ok: false, reason: "state" });
    expect(await completeConnect({ state: state("n"), code: null, cookieNonce: "n", expected }, deps)).toEqual({ ok: false, reason: "state" });
    expect(await completeConnect({ state: state("n"), code: "c", cookieNonce: "n", expected }, { ...deps, now: new Date(NOW.getTime() + 11 * 60_000) })).toEqual({ ok: false, reason: "state" });
    expect(await completeConnect({ state: state("n"), code: "c", cookieNonce: "n", expected: { orgId: "org-2", userId: "user-1" } }, deps)).toEqual({ ok: false, reason: "state" });
    expect(m.inserted).toEqual([]);
  });

  it("first connect: inserts with defaults and re-queues the scope", async () => {
    const m = memoryStore();
    const out = await completeConnect(
      { state: state("n"), code: "c", cookieNonce: "n", expected },
      { cfg, redirectUri: REDIRECT, store: m.store, listCalendars: async () => cals, fetchImpl: tokenFetch, now: NOW },
    );
    expect(out).toEqual({ ok: true, connectionId: "conn-new", reconnected: false });
    expect(m.inserted[0]).toMatchObject({
      orgId: "org-1", userId: "user-1", staffId: "staff-1", accountEmail: "me@example.com",
      refreshToken: "rt", accessToken: "at", pushCalendarId: "me@example.com", busyCalendarIds: ["me@example.com"],
    });
    expect(m.inserted[0].calendars).toHaveLength(2);
    expect(m.requeued).toEqual(["staff-1"]);
  });

  it("the same Google account again is a reconnect: tokens and calendars refresh, choices stay", async () => {
    const m = memoryStore([{ id: "conn-old", orgId: "org-1", accountEmail: "me@example.com", staffId: null }]);
    const out = await completeConnect(
      { state: state("n"), code: "c", cookieNonce: "n", expected },
      { cfg, redirectUri: REDIRECT, store: m.store, listCalendars: async () => cals, fetchImpl: tokenFetch, now: NOW },
    );
    expect(out).toEqual({ ok: true, connectionId: "conn-old", reconnected: true });
    expect(m.inserted).toEqual([]);
    expect(m.reconnected).toEqual([{ id: "conn-old", calendars: 2 }]);
    expect(m.requeued).toEqual([null]);
  });

  it("Google refusing the code is reported, not thrown", async () => {
    const m = memoryStore();
    const bad: typeof fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
    expect(
      await completeConnect({ state: state("n"), code: "c", cookieNonce: "n", expected }, { cfg, redirectUri: REDIRECT, store: m.store, listCalendars: async () => cals, fetchImpl: bad, now: NOW }),
    ).toEqual({ ok: false, reason: "google" });
  });
});
