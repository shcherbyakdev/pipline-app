import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { seal, open } from "@/lib/google/crypto";
import { GoogleAuthError, refreshAccessToken, type OAuthConfig } from "@/lib/google/oauth";
import { createGoogleClient, type CalendarInfo, type GoogleCalendarClient } from "@/lib/google/calendar";
import { getEntitlementsAdmin } from "@/lib/billing/queries";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { plansEnforced } from "@/lib/flags";
import type { ConnectStore } from "./oauth-flow";

/* The connection rows and everything that needs the sealed tokens (spec
   2026-09-05 §2.5, §2.7, §2.9). Every read here is service_role: the
   tables have no other grant. Callers resolve the org first (requireOrg,
   a booking's org_id, a handle). */

export type ConnectionStatus = "active" | "needs_reconnect";

export type Connection = {
  id: string;
  orgId: string;
  /** null = shared (blocks everyone, receives bookings with no person). */
  staffId: string | null;
  accountEmail: string;
  pushCalendarId: string | null;
  busyCalendarIds: string[];
  calendars: CalendarInfo[];
  status: ConnectionStatus;
  /** v2: the client is a guest on the event (Google mails them too). */
  inviteClients: boolean;
  /** v2 opt-ins: a Google delete/decline cancels; a Google move reschedules. */
  cancelOnDelete: boolean;
  rescheduleOnMove: boolean;
  watch: { channelId: string; resourceId: string; expiresAt: Date | null } | null;
  inboundCheckedAt: Date | null;
  inboundNotice: string | null;
};

/** The columns the page and the sync read — never the token columns. */
export const CONNECTION_COLUMNS =
  "id, org_id, staff_id, account_email, push_calendar_id, busy_calendar_ids, calendars, status, invite_clients, cancel_on_delete, reschedule_on_move, watch_channel_id, watch_resource_id, watch_expires_at, inbound_checked_at, inbound_notice";

type ConnectionRow = {
  id: string;
  org_id: string;
  staff_id: string | null;
  account_email: string;
  push_calendar_id: string | null;
  busy_calendar_ids: string[];
  calendars: unknown;
  status: string;
  invite_clients: boolean;
  cancel_on_delete: boolean;
  reschedule_on_move: boolean;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expires_at: string | null;
  inbound_checked_at: string | null;
  inbound_notice: string | null;
};

export function rowToConnection(r: ConnectionRow): Connection {
  return {
    id: r.id,
    orgId: r.org_id,
    staffId: r.staff_id,
    accountEmail: r.account_email,
    pushCalendarId: r.push_calendar_id,
    busyCalendarIds: r.busy_calendar_ids ?? [],
    calendars: Array.isArray(r.calendars) ? (r.calendars as CalendarInfo[]) : [],
    status: r.status === "needs_reconnect" ? "needs_reconnect" : "active",
    inviteClients: r.invite_clients ?? true,
    cancelOnDelete: r.cancel_on_delete ?? false,
    rescheduleOnMove: r.reschedule_on_move ?? false,
    watch:
      r.watch_channel_id && r.watch_resource_id
        ? { channelId: r.watch_channel_id, resourceId: r.watch_resource_id, expiresAt: r.watch_expires_at ? new Date(r.watch_expires_at) : null }
        : null,
    inboundCheckedAt: r.inbound_checked_at ? new Date(r.inbound_checked_at) : null,
    inboundNotice: r.inbound_notice,
  };
}

export function googleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GCAL_TOKEN_KEY);
}

export function oauthConfig(): OAuthConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    oauthBase: env.GOOGLE_OAUTH_BASE ?? "https://accounts.google.com",
    tokenBase: env.GOOGLE_OAUTH_BASE ?? "https://oauth2.googleapis.com",
    stateKey: env.GCAL_TOKEN_KEY!,
  };
}

export function apiBase(): string {
  return env.GOOGLE_API_BASE ?? "https://www.googleapis.com";
}

/** Registered verbatim in the Google Cloud console (one per environment). */
export function redirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/google/callback`;
}

export async function listConnections(orgId: string, db: SupabaseClient = createAdminClient()): Promise<Connection[]> {
  const { data, error } = await db
    .from("calendar_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as ConnectionRow[]).map(rowToConnection);
}

/** Which connection a booking belongs to: the person's, else the shared
    one. Bookings with no person (spaces) can only land on the shared one.
    Pure. */
export function targetFor(staffId: string | null, connections: Connection[]): Connection | null {
  return (
    (staffId ? connections.find((c) => c.staffId === staffId) : undefined) ??
    connections.find((c) => c.staffId === null) ??
    null
  );
}

/** Pro/Team perk (plans.ts gcalSync), enforced only once the org's limits
    are (plansEnforced) — the reminder-lead idiom. Admin-side reads that
    degrade to Free on failure, so a billing hiccup pauses sync rather than
    breaking a booking. */
export async function calendarSyncAllowed(orgId: string): Promise<boolean> {
  if (!plansEnforced(await getOrgFlagsAdmin(orgId))) return true;
  return (await getEntitlementsAdmin(orgId)).gcalSync;
}

/** A Google client for one connection. The access token is refreshed
    through the sealed refresh token when missing, expired or refused, and
    the new one is sealed back onto the row so the next request (on any
    instance) reuses it. A dead refresh token (invalid_grant) marks the row
    needs_reconnect and rethrows: the caller stops, the page shows
    Reconnect. */
export function clientFor(connectionId: string, db: SupabaseClient = createAdminClient(), fetchImpl?: typeof fetch): GoogleCalendarClient {
  const key = env.GCAL_TOKEN_KEY!;
  let cached: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(force: boolean): Promise<string> {
    if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
    const { data, error } = await db
      .from("calendar_connections")
      .select("refresh_token_enc, access_token_enc, access_expires_at")
      .eq("id", connectionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new GoogleAuthError("no_connection");
    const storedExpiry = data.access_expires_at ? new Date(data.access_expires_at).getTime() : 0;
    if (!force && data.access_token_enc && storedExpiry > Date.now()) {
      cached = { token: open(data.access_token_enc, key), expiresAt: storedExpiry };
      return cached.token;
    }
    let fresh: { accessToken: string; expiresAt: Date };
    try {
      fresh = await refreshAccessToken(open(data.refresh_token_enc, key), oauthConfig(), fetchImpl);
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") await markNeedsReconnect(connectionId, db);
      throw e;
    }
    await db
      .from("calendar_connections")
      .update({ access_token_enc: seal(fresh.accessToken, key), access_expires_at: fresh.expiresAt.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", connectionId);
    cached = { token: fresh.accessToken, expiresAt: fresh.expiresAt.getTime() };
    return cached.token;
  }

  return createGoogleClient({ apiBase: apiBase(), getAccessToken, fetchImpl });
}

export async function markNeedsReconnect(connectionId: string, db: SupabaseClient = createAdminClient()): Promise<void> {
  const { error } = await db
    .from("calendar_connections")
    .update({ status: "needs_reconnect", access_token_enc: null, access_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) console.error("[calendar] mark needs_reconnect failed:", error);
}

/** Every upcoming confirmed booking in a scope (a person's, or — for the
    shared connection — every booking with no person AND every person who
    has no connection of their own) is queued again, so a new or changed
    destination calendar receives what it should. Same upsert the trigger
    does, issued for the whole scope at once. */
export async function requeueScope(orgId: string, staffId: string | null, db: SupabaseClient = createAdminClient()): Promise<void> {
  let query = db
    .from("bookings")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gte("ends_at", new Date().toISOString());
  if (staffId) {
    query = query.eq("staff_id", staffId);
  } else {
    const { data: owned, error: e } = await db.from("calendar_connections").select("staff_id").eq("org_id", orgId).not("staff_id", "is", null);
    if (e) throw e;
    const ids = (owned ?? []).map((r) => r.staff_id as string);
    if (ids.length) query = query.or(`staff_id.is.null,staff_id.not.in.(${ids.join(",")})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return;
  const { error: up } = await db
    .from("booking_calendar_events")
    .upsert(
      data.map((b) => ({ booking_id: b.id, org_id: orgId, pending: true, attempts: 0, last_error: null, updated_at: new Date().toISOString() })),
      { onConflict: "booking_id" },
    );
  if (up) throw up;
}

// ---------- the connect flow's store (oauth-flow.ts ConnectStore)

export function supabaseConnectStore(db: SupabaseClient = createAdminClient()): ConnectStore {
  const key = () => env.GCAL_TOKEN_KEY!;
  return {
    async orgContext(orgId) {
      const [org, staff] = await Promise.all([
        db.from("orgs").select("offers_appointments").eq("id", orgId).maybeSingle(),
        db.from("staff").select("id").eq("org_id", orgId).eq("active", true),
      ]);
      if (org.error) throw org.error;
      if (staff.error) throw staff.error;
      return { offersAppointments: org.data?.offers_appointments ?? false, activeStaffIds: (staff.data ?? []).map((s) => s.id) };
    },
    async findByEmail(orgId, accountEmail) {
      const { data, error } = await db.from("calendar_connections").select("id, staff_id").eq("org_id", orgId).eq("account_email", accountEmail).maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, staffId: data.staff_id } : null;
    },
    async insert(row) {
      const { data, error } = await db
        .from("calendar_connections")
        .insert({
          org_id: row.orgId,
          user_id: row.userId,
          staff_id: row.staffId,
          account_email: row.accountEmail,
          refresh_token_enc: seal(row.refreshToken, key()),
          access_token_enc: seal(row.accessToken, key()),
          access_expires_at: row.accessExpiresAt.toISOString(),
          push_calendar_id: row.pushCalendarId,
          busy_calendar_ids: row.busyCalendarIds,
          calendars: row.calendars,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    async reconnect(id, patch) {
      const { error } = await db
        .from("calendar_connections")
        .update({
          refresh_token_enc: seal(patch.refreshToken, key()),
          access_token_enc: seal(patch.accessToken, key()),
          access_expires_at: patch.accessExpiresAt.toISOString(),
          calendars: patch.calendars,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    requeueScope: (orgId, staffId) => requeueScope(orgId, staffId, db),
  };
}
