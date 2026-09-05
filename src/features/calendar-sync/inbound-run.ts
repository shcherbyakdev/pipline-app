import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailTranslators } from "@/i18n/emails";
import { sendPush } from "@/features/notifications/push";
import { bookingTitle } from "@/features/scheduling/booking-label";
import { calendarSyncAllowed, clientFor, googleConfigured, CONNECTION_COLUMNS, rowToConnection, type Connection } from "./connections";
import { pollConnection, type InboundDeps, type PollSummary } from "./inbound";
import { applyGoogleCancel, applyGoogleReschedule } from "./inbound-apply";
import { runCalendarSync } from "./run";

/* Google → Booklo, the production side (spec v2 decision 19): the push
   channel per connection, the poll every notification and every tick run,
   and the refusal push. Same shape as run.ts for the other direction. */

// ---------- webhook token: proves a notification is for a channel WE opened.

export function webhookToken(connectionId: string): string {
  return createHmac("sha256", env.GCAL_TOKEN_KEY ?? "").update(`gcal-webhook:${connectionId}`).digest("base64url");
}

export function verifyWebhookToken(connectionId: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(webhookToken(connectionId));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where Google should post. Google insists on https on a verified domain;
    the local fake takes anything, so an overridden API base lifts the rule. */
export function webhookAddress(): string | null {
  const origin = env.NEXT_PUBLIC_APP_URL;
  if (!origin.startsWith("https://") && !env.GOOGLE_API_BASE) return null;
  return `${origin}/api/google/webhook`;
}

// ---------- channel lifecycle

const RENEW_WITHIN_MS = 24 * 60 * 60_000;

/** Open, renew or stop the connection's channel to match its switches:
    both off → no channel; on and (missing | expiring within a day |
    pointing at another calendar) → a fresh one, the old one stopped. */
export async function ensureWatch(conn: Connection, db: SupabaseClient = createAdminClient(), opts: { force?: boolean } = {}): Promise<void> {
  const wanted = conn.status === "active" && Boolean(conn.pushCalendarId) && (conn.cancelOnDelete || conn.rescheduleOnMove);
  const address = webhookAddress();
  const client = clientFor(conn.id, db);
  const clear = () =>
    db
      .from("calendar_connections")
      .update({ watch_channel_id: null, watch_resource_id: null, watch_expires_at: null })
      .eq("id", conn.id);

  if (!wanted || !address) {
    if (conn.watch) {
      await client.stopChannel(conn.watch.channelId, conn.watch.resourceId).catch((e) => console.error("[calendar] stop channel:", e));
      await clear();
    }
    return;
  }
  const expiresSoon = !conn.watch?.expiresAt || conn.watch.expiresAt.getTime() - Date.now() < RENEW_WITHIN_MS;
  if (conn.watch && !expiresSoon && !opts.force) return;

  const opened = await client.watchEvents(conn.pushCalendarId!, { id: randomUUID(), address, token: webhookToken(conn.id) });
  const { error } = await db
    .from("calendar_connections")
    .update({ watch_channel_id: opened.id, watch_resource_id: opened.resourceId, watch_expires_at: opened.expiresAt?.toISOString() ?? null })
    .eq("id", conn.id);
  if (error) throw error;
  if (conn.watch) await client.stopChannel(conn.watch.channelId, conn.watch.resourceId).catch((e) => console.error("[calendar] stop old channel:", e));
}

// ---------- the poll with real deps

type BookingRow = {
  id: string; org_id: string; status: string; staff_id: string | null; rental_unit_id: string | null; starts_at: string; ends_at: string;
  client_name: string; client_email: string | null; note: string | null;
  services: { name: string } | null; rental_offerings: { name: string } | null; rental_units: { name: string } | null; orgs: { timezone: string } | null;
};

function inboundDeps(conn: Connection, db: SupabaseClient): InboundDeps {
  return {
    client: clientFor(conn.id, db),
    store: {
      async loadBookingWithState(bookingId) {
        const [b, s] = await Promise.all([
          db
            .from("bookings")
            .select("id, org_id, status, staff_id, rental_unit_id, starts_at, ends_at, client_name, client_email, note, services(name), rental_offerings(name), rental_units(name), orgs(timezone)")
            .eq("id", bookingId)
            .eq("org_id", conn.orgId)
            .maybeSingle(),
          db.from("booking_calendar_events").select("connection_id, calendar_id, event_id").eq("booking_id", bookingId).maybeSingle(),
        ]);
        if (b.error || !b.data) return null;
        const r = b.data as unknown as BookingRow;
        return {
          booking: {
            id: r.id, orgId: r.org_id, status: r.status, staffId: r.staff_id, rentalUnitId: r.rental_unit_id, startsAt: r.starts_at, endsAt: r.ends_at,
            clientName: r.client_name, clientEmail: r.client_email, note: r.note, title: bookingTitle(r, "Booking"), timeZone: r.orgs?.timezone ?? "UTC",
          },
          state: s.data?.calendar_id && s.data.event_id ? { connectionId: s.data.connection_id, calendarId: s.data.calendar_id, eventId: s.data.event_id } : null,
        };
      },
      async requeue(bookingId, orgId) {
        const { error } = await db
          .from("booking_calendar_events")
          .upsert({ booking_id: bookingId, org_id: orgId, pending: true, attempts: 0, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "booking_id" });
        if (error) throw error;
      },
      async markChecked(connectionId, at, notice) {
        const { error } = await db.from("calendar_connections").update({ inbound_checked_at: at.toISOString(), inbound_notice: notice }).eq("id", connectionId);
        if (error) throw error;
      },
    },
    apply: {
      cancel: (booking) => applyGoogleCancel(booking, db),
      reschedule: (booking, startsAt) => applyGoogleReschedule(booking, startsAt, db),
    },
    notify: async (c, notice) => {
      try {
        const [reason, client] = notice.split(":");
        const { data: org } = await db.from("orgs").select("locale").eq("id", c.orgId).maybeSingle();
        const mail = await emailTranslators(org?.locale ?? "en");
        const key = (["slotTaken", "spaces", "notFound", "failed"] as const).find((k) => k === reason) ?? "failed";
        await sendPush(c.userId, {
          title: mail.t("push.calendarRefused.title"),
          body: mail.t("push.calendarRefused.body", { client, reason: mail.t(`push.calendarReason.${key}`) }),
          url: "/integrations",
          tag: `calendar-refused-${c.id}`,
        });
      } catch (error) {
        console.error("[calendar] refusal push failed:", error);
      }
    },
  };
}

export type InboundSummary = PollSummary & { connections: number; watched: number };

/** Poll one connection (a webhook) or every connection with a switch on
    (the tick), then make sure each one's channel matches its switches. A
    booking the poll changed is mirrored straight back (the moved event's
    old copy deleted, the new row inserted) by running the outbound sync
    for the org. Never throws. */
export async function runInbound(opts: { connectionId?: string } = {}, db: SupabaseClient = createAdminClient()): Promise<InboundSummary> {
  const summary: InboundSummary = { seen: 0, cancelled: 0, rescheduled: 0, snappedBack: 0, connections: 0, watched: 0 };
  if (!googleConfigured()) return summary;
  let query = db.from("calendar_connections").select(CONNECTION_COLUMNS).eq("status", "active");
  query = opts.connectionId ? query.eq("id", opts.connectionId) : query.or("cancel_on_delete.eq.true,reschedule_on_move.eq.true");
  const { data, error } = await query;
  if (error) {
    console.error("[calendar] inbound: connections read failed:", error);
    return summary;
  }
  const touchedOrgs = new Set<string>();
  for (const row of data ?? []) {
    const conn = rowToConnection(row);
    summary.connections += 1;
    try {
      if (!(await calendarSyncAllowed(conn.orgId))) continue;
      const s = await pollConnection(conn, inboundDeps(conn, db));
      summary.seen += s.seen;
      summary.cancelled += s.cancelled;
      summary.rescheduled += s.rescheduled;
      summary.snappedBack += s.snappedBack;
      if (s.cancelled + s.rescheduled + s.snappedBack > 0) touchedOrgs.add(conn.orgId);
      await ensureWatch(conn, db);
      summary.watched += 1;
    } catch (error) {
      console.error(`[calendar] inbound for connection ${conn.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  for (const orgId of touchedOrgs) {
    await runCalendarSync({ orgId }, db).catch((e) => console.error("[calendar] mirror after inbound failed:", e));
  }
  return summary;
}

/** After a connect, a switch change or a destination change: the channel
    follows the new settings now, not at the next tick. `force` when the
    destination calendar changed — the channel watches a calendar, so it
    must be reopened on the new one. Best-effort. */
export async function refreshWatch(connectionId: string, opts: { force?: boolean } = {}, db: SupabaseClient = createAdminClient()): Promise<void> {
  try {
    const { data } = await db.from("calendar_connections").select(CONNECTION_COLUMNS).eq("id", connectionId).maybeSingle();
    if (!data) return;
    await ensureWatch(rowToConnection(data), db, opts);
  } catch (error) {
    console.error("[calendar] refresh watch failed:", error instanceof Error ? error.message : error);
  }
}

