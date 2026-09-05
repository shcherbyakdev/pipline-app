import { randomBytes } from "node:crypto";
import type { CalendarInfo } from "@/lib/google/calendar";
import { authUrl, exchangeCode, GoogleAuthError, signState, verifyState, type OAuthConfig, type StatePayload } from "@/lib/google/oauth";

/* The connect flow's logic, DB and HTTP behind seams (spec 2026-09-05 §5
   "Connect"): the two route handlers are thin, this is what the tests
   exercise. */

export const NONCE_COOKIE = "gcal_oauth";
export const NONCE_MAX_AGE = 600;

export function beginConnect(payload: Omit<StatePayload, "nonce">, cfg: OAuthConfig, redirectUri: string, now = new Date()): { url: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  return { url: authUrl(signState({ ...payload, nonce }, cfg, now), redirectUri, cfg), nonce };
}

export type ConnectionDefaults = {
  staffId: string | null;
  accountEmail: string;
  pushCalendarId: string;
  busyCalendarIds: string[];
};

/** Pure. The account email is the primary calendar's id. Bookings go to
    the primary calendar and its Busy time blocks, until the person changes
    it. Who it belongs to: the person the connect was started for, else the
    org's only active person when it offers appointments, else shared. */
export function connectionDefaults(
  calendars: CalendarInfo[],
  ctx: { requestedStaffId: string | null; offersAppointments: boolean; activeStaffIds: string[] },
): ConnectionDefaults | null {
  const primary = calendars.find((c) => c.primary) ?? calendars.find((c) => c.canWrite) ?? calendars[0];
  if (!primary) return null;
  const staffId =
    ctx.requestedStaffId ?? (ctx.offersAppointments && ctx.activeStaffIds.length === 1 ? ctx.activeStaffIds[0] : null);
  return { staffId, accountEmail: primary.id, pushCalendarId: primary.id, busyCalendarIds: [primary.id] };
}

export type ConnectStore = {
  orgContext(orgId: string): Promise<{ offersAppointments: boolean; activeStaffIds: string[] }>;
  findByEmail(orgId: string, accountEmail: string): Promise<{ id: string; staffId: string | null } | null>;
  insert(row: {
    orgId: string;
    userId: string;
    staffId: string | null;
    accountEmail: string;
    refreshToken: string;
    accessToken: string;
    accessExpiresAt: Date;
    pushCalendarId: string;
    busyCalendarIds: string[];
    calendars: CalendarInfo[];
  }): Promise<string>;
  /** A reconnect: new tokens, fresh calendar list, back to active; the person's choices stay. */
  reconnect(id: string, patch: { refreshToken: string; accessToken: string; accessExpiresAt: Date; calendars: CalendarInfo[] }): Promise<void>;
  requeueScope(orgId: string, staffId: string | null): Promise<void>;
};

export type ConnectDeps = {
  cfg: OAuthConfig;
  redirectUri: string;
  store: ConnectStore;
  listCalendars: (accessToken: string) => Promise<CalendarInfo[]>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type ConnectResult =
  | { ok: true; connectionId: string; reconnected: boolean }
  | { ok: false; reason: "state" | "google" | "no_calendars" };

export async function completeConnect(
  input: {
    state: string | null;
    code: string | null;
    cookieNonce: string | undefined;
    /** The signed-in session at callback time must be the one that started the flow. */
    expected: { orgId: string; userId: string };
  },
  deps: ConnectDeps,
): Promise<ConnectResult> {
  const now = deps.now ?? new Date();
  const payload = input.state ? verifyState(input.state, deps.cfg, now) : null;
  if (!payload || !input.code || !input.cookieNonce || payload.nonce !== input.cookieNonce) return { ok: false, reason: "state" };
  if (payload.orgId !== input.expected.orgId || payload.userId !== input.expected.userId) return { ok: false, reason: "state" };

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  let calendars: CalendarInfo[];
  try {
    tokens = await exchangeCode(input.code, deps.redirectUri, deps.cfg, deps.fetchImpl, now);
    calendars = await deps.listCalendars(tokens.accessToken);
  } catch (error) {
    console.error("[calendar] connect failed:", error instanceof GoogleAuthError ? error.code : error);
    return { ok: false, reason: "google" };
  }

  const ctx = await deps.store.orgContext(payload.orgId);
  const defaults = connectionDefaults(calendars, { requestedStaffId: payload.staffId, ...ctx });
  if (!defaults) return { ok: false, reason: "no_calendars" };

  const existing = await deps.store.findByEmail(payload.orgId, defaults.accountEmail);
  let connectionId: string;
  let staffId: string | null;
  if (existing) {
    await deps.store.reconnect(existing.id, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, accessExpiresAt: tokens.expiresAt, calendars });
    connectionId = existing.id;
    staffId = existing.staffId;
  } else {
    connectionId = await deps.store.insert({
      orgId: payload.orgId,
      userId: payload.userId,
      staffId: defaults.staffId,
      accountEmail: defaults.accountEmail,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.expiresAt,
      pushCalendarId: defaults.pushCalendarId,
      busyCalendarIds: defaults.busyCalendarIds,
      calendars,
    });
    staffId = defaults.staffId;
  }
  await deps.store.requeueScope(payload.orgId, staffId);
  return { ok: true, connectionId, reconnected: Boolean(existing) };
}
