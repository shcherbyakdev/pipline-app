import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleCalendarClient } from "@/lib/google/calendar";
import { GoogleAuthError } from "@/lib/google/oauth";
import { bookingTitle } from "@/features/scheduling/booking-label";
import { buildEventBody, eventIdFor, type SyncBooking } from "./event-body";
import { targetFor, type Connection } from "./connections";

/* The mirror (spec 2026-09-05 §2.3, §5 "Push"). One function reconciles a
   booking's DESIRED Google state (an event in exactly one connection +
   calendar, or none) with what the state row says EXISTS; the drain runs
   it over the pending rows the trigger queued. No env, no Supabase import
   in this file: everything arrives through deps so the reconcile table and
   the loop are unit-tested against fakes, and the Supabase-backed store
   lives in store.ts. */

export type SyncState = { connectionId: string | null; calendarId: string; eventId: string } | null;

export type SyncDeps = {
  connections: Connection[];
  clientFor: (connectionId: string) => GoogleCalendarClient;
  appUrl: string;
};

export type SyncOutcome =
  /** Google now matches; `state` is what exists. */
  | { outcome: "synced"; state: SyncState }
  /** The connection involved needs a reconnect: nothing touched, try later. */
  | { outcome: "waiting"; state: SyncState };

export async function syncBooking(b: SyncBooking, state: SyncState, deps: SyncDeps): Promise<SyncOutcome> {
  // A state whose connection was deleted (FK set null) owns nothing we can
  // reach: the event stays in Google (decision 11), the row forgets it.
  const existing = state && state.connectionId ? state : null;

  const target = b.status === "confirmed" ? targetFor(b.staffId, deps.connections) : null;
  if (target && target.status !== "active") return { outcome: "waiting", state: existing };
  const desired = target && target.pushCalendarId ? { connectionId: target.id, calendarId: target.pushCalendarId } : null;

  const moved = existing && desired && (existing.connectionId !== desired.connectionId || existing.calendarId !== desired.calendarId);
  if (existing && (!desired || moved)) {
    const owner = deps.connections.find((c) => c.id === existing.connectionId);
    if (!owner) {
      // Connection row gone between the read and now: same as above.
    } else if (owner.status !== "active") {
      return { outcome: "waiting", state: existing };
    } else {
      // Guests (v2) hear about the removal from Google as well as from Booklo.
      await deps.clientFor(owner.id).deleteEvent(existing.calendarId, existing.eventId, owner.inviteClients ? "all" : "none");
    }
  }

  if (!desired || !target) return { outcome: "synced", state: null };
  await deps
    .clientFor(desired.connectionId)
    .upsertEvent(desired.calendarId, buildEventBody(b, deps.appUrl, { inviteClient: target.inviteClients }), target.inviteClients ? "all" : "none");
  return { outcome: "synced", state: { ...desired, eventId: eventIdFor(b.id) } };
}

// ---------- the drain

/** `queuedAt` is the row's updated_at as read: the store's writes
    compare-and-swap on it, so a change the trigger queued WHILE this row
    was being synced keeps its pending flag (the next kick or tick picks
    it up) instead of being cleared by a sync that never saw it. */
export type PendingRow = { bookingId: string; orgId: string; attempts: number; state: SyncState; queuedAt: string };

export type SyncStore = {
  loadPending(opts: { orgId?: string; limit: number; maxAttempts: number }): Promise<PendingRow[]>;
  loadBookings(ids: string[]): Promise<SyncBooking[]>;
  /** Record what exists; clear pending only if nothing re-queued the row since `queuedAt`. */
  saveState(bookingId: string, state: NonNullable<SyncState>, queuedAt: string): Promise<void>;
  /** Nothing exists and nothing should: drop the row, unless it was re-queued since `queuedAt` (then just forget the state). */
  deleteState(bookingId: string, queuedAt: string): Promise<void>;
  /** Bump attempts, unless the row was re-queued since `queuedAt` (its fresh attempts=0 wins). */
  recordFailure(bookingId: string, attempts: number, error: string, queuedAt: string): Promise<void>;
};

export type DrainDeps = {
  store: SyncStore;
  connectionsFor: (orgId: string) => Promise<Connection[]>;
  clientFor: (connectionId: string) => GoogleCalendarClient;
  allowed: (orgId: string) => Promise<boolean>;
  appUrl: string;
};

export const SYNC_MAX_ATTEMPTS = 5;
export const SYNC_BATCH_LIMIT = 50;

export type DrainSummary = { synced: number; failed: number; skipped: number };

/** Process pending rows — one org's (the kick after a booking action) or
    everyone's (the 15-minute tick). Per-org gate and connections are read
    once; each row is its own try so one bad booking never stops the rest.
    A dead refresh token is not a failure of the row (attempts untouched):
    the connection is now needs_reconnect and every row of that scope waits
    for the person to reconnect. ponytail: a kick and a tick may reconcile
    the same row at once — both land on the same idempotent upsert/delete,
    so the worst case is one wasted Google call. */
export async function runCalendarSyncDrain(
  opts: { orgId?: string; limit?: number },
  deps: DrainDeps,
): Promise<DrainSummary> {
  const summary: DrainSummary = { synced: 0, failed: 0, skipped: 0 };
  const rows = await deps.store.loadPending({ orgId: opts.orgId, limit: opts.limit ?? SYNC_BATCH_LIMIT, maxAttempts: SYNC_MAX_ATTEMPTS });
  if (rows.length === 0) return summary;

  const byOrg = new Map<string, PendingRow[]>();
  for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
  const bookings = new Map((await deps.store.loadBookings(rows.map((r) => r.bookingId))).map((b) => [b.id, b]));

  for (const [orgId, orgRows] of byOrg) {
    if (!(await deps.allowed(orgId))) {
      summary.skipped += orgRows.length;
      continue;
    }
    const connections = await deps.connectionsFor(orgId);
    // Clients are per connection per run: the access token is fetched once
    // and reused across every row of the org.
    const clients = new Map<string, GoogleCalendarClient>();
    const clientFor = (id: string) => {
      let c = clients.get(id);
      if (!c) clients.set(id, (c = deps.clientFor(id)));
      return c;
    };
    for (const row of orgRows) {
      const b = bookings.get(row.bookingId);
      if (!b) {
        // The booking is gone (cascade); the row's FK would have gone with
        // it, but a read-then-delete race is possible. Drop it.
        await deps.store.deleteState(row.bookingId, row.queuedAt);
        summary.synced += 1;
        continue;
      }
      try {
        const out = await syncBooking(b, row.state, { connections, clientFor, appUrl: deps.appUrl });
        if (out.outcome === "waiting") {
          summary.skipped += 1;
          continue;
        }
        if (out.state) await deps.store.saveState(b.id, out.state, row.queuedAt);
        else await deps.store.deleteState(b.id, row.queuedAt);
        summary.synced += 1;
      } catch (error) {
        if (error instanceof GoogleAuthError && error.code === "invalid_grant") {
          summary.skipped += 1;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[calendar] sync failed for booking ${b.id}:`, message);
        await deps.store.recordFailure(b.id, row.attempts + 1, message.slice(0, 500), row.queuedAt);
        summary.failed += 1;
      }
    }
  }
  return summary;
}

// ---------- the Supabase-backed store

type BookingRow = {
  id: string;
  org_id: string;
  status: string;
  staff_id: string | null;
  rental_unit_id: string | null;
  starts_at: string;
  ends_at: string;
  client_name: string;
  client_email: string | null;
  note: string | null;
  services: { name: string } | null;
  rental_offerings: { name: string } | null;
  rental_units: { name: string } | null;
  orgs: { timezone: string } | null;
};

export function supabaseSyncStore(db: SupabaseClient): SyncStore {
  return {
    async loadPending({ orgId, limit, maxAttempts }) {
      let q = db
        .from("booking_calendar_events")
        .select("booking_id, org_id, attempts, connection_id, calendar_id, event_id, updated_at")
        .eq("pending", true)
        .lt("attempts", maxAttempts)
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (orgId) q = q.eq("org_id", orgId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        bookingId: r.booking_id,
        orgId: r.org_id,
        attempts: r.attempts,
        state: r.calendar_id && r.event_id ? { connectionId: r.connection_id, calendarId: r.calendar_id, eventId: r.event_id } : null,
        queuedAt: r.updated_at,
      }));
    },
    async loadBookings(ids) {
      const { data, error } = await db
        .from("bookings")
        .select(
          "id, org_id, status, staff_id, rental_unit_id, starts_at, ends_at, client_name, client_email, note, services(name), rental_offerings(name), rental_units(name), orgs(timezone)",
        )
        .in("id", ids);
      if (error) throw error;
      return ((data ?? []) as unknown as BookingRow[]).map((r) => ({
        id: r.id,
        orgId: r.org_id,
        status: r.status,
        staffId: r.staff_id,
        rentalUnitId: r.rental_unit_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        clientName: r.client_name,
        clientEmail: r.client_email,
        note: r.note,
        title: bookingTitle(r, "Booking"),
        timeZone: r.orgs?.timezone ?? "UTC",
      }));
    },
    async saveState(bookingId, state, queuedAt) {
      // What exists is true regardless of the race; the flag is the CAS.
      const { error } = await db
        .from("booking_calendar_events")
        .update({ connection_id: state.connectionId, calendar_id: state.calendarId, event_id: state.eventId })
        .eq("booking_id", bookingId);
      if (error) throw error;
      const { error: e2 } = await db
        .from("booking_calendar_events")
        .update({ pending: false, attempts: 0, last_error: null, updated_at: new Date().toISOString() })
        .eq("booking_id", bookingId)
        .eq("updated_at", queuedAt);
      if (e2) throw e2;
    },
    async deleteState(bookingId, queuedAt) {
      const { data, error } = await db
        .from("booking_calendar_events")
        .delete()
        .eq("booking_id", bookingId)
        .eq("updated_at", queuedAt)
        .select("booking_id");
      if (error) throw error;
      if (data?.length) return;
      // Re-queued meanwhile: keep the row pending, forget the state.
      const { error: e2 } = await db
        .from("booking_calendar_events")
        .update({ connection_id: null, calendar_id: null, event_id: null })
        .eq("booking_id", bookingId);
      if (e2) throw e2;
    },
    async recordFailure(bookingId, attempts, message, queuedAt) {
      // Same CAS as the two writes above (review 2026-09-05): a change the
      // trigger queued mid-flight reset attempts to 0 and must keep its full
      // budget; a miss here just leaves that fresh row to the next pass.
      const { error } = await db
        .from("booking_calendar_events")
        .update({ attempts, last_error: message, updated_at: new Date().toISOString() })
        .eq("booking_id", bookingId)
        .eq("updated_at", queuedAt);
      if (error) throw error;
    },
  };
}
