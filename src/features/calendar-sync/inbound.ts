import type { GoogleCalendarClient, GoogleEvent } from "@/lib/google/calendar";
import { BOOKLO_MARKER, bookingIdFromEventId, type SyncBooking } from "./event-body";
import type { Connection } from "./connections";
import type { SyncState } from "./sync";

/* Google → Booklo (spec 2026-09-05 v2, decisions 17–19): what an edit the
   owner made in Google means for the booking behind it, and the poll that
   finds those edits. Pure decisions here; the apply functions (cancel,
   reschedule) and the store arrive through deps so the loop is tested
   against fakes — inbound-apply.ts holds the real ones. */

export type InboundDecision =
  | { kind: "ignore"; reason: string }
  | { kind: "cancel" }
  | { kind: "reschedule"; startsAt: Date }
  /** A move Booklo cannot honour: put the event back and say why. */
  | { kind: "snapBack"; notice: string };

const MOVE_TOLERANCE_MS = 60_000;

/** The account itself, on a calendar where it is a guest rather than the
    organiser, declining = "not happening" (Calendly's "decline or delete"). */
function selfDeclined(e: GoogleEvent): boolean {
  return e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
}

/** Which booking an event speaks for: the marker when Google sent it, else
    the id itself — a deleted event comes back with nothing but its id
    (review 2026-09-05). Ownership is proven below by the state row, never
    by this guess. */
export function bookingIdOf(event: GoogleEvent): string | null {
  return event.extendedProperties?.private?.[BOOKLO_MARKER] ?? bookingIdFromEventId(event.id);
}

export function classifyInbound(event: GoogleEvent, booking: SyncBooking | null, state: SyncState, conn: Connection): InboundDecision {
  const candidate = bookingIdOf(event);
  if (!candidate) return { kind: "ignore", reason: "not ours" };
  if (!booking || booking.id !== candidate) return { kind: "ignore", reason: "no booking" };
  // Only the booking's CURRENT mirror speaks for it: an event left behind
  // on an old calendar, or one another connection owns, is history. This
  // is also what makes the id-derived candidate safe.
  if (!state || state.connectionId !== conn.id || state.eventId !== event.id) return { kind: "ignore", reason: "stale mirror" };
  if (booking.status !== "confirmed") return { kind: "ignore", reason: `booking is ${booking.status}` };

  if (event.status === "cancelled" || selfDeclined(event)) {
    return conn.cancelOnDelete ? { kind: "cancel" } : { kind: "ignore", reason: "cancel_on_delete off" };
  }
  if (!event.start?.dateTime) return { kind: "ignore", reason: "no start" };
  const movedTo = new Date(event.start.dateTime);
  if (Math.abs(movedTo.getTime() - new Date(booking.startsAt).getTime()) < MOVE_TOLERANCE_MS) return { kind: "ignore", reason: "unchanged" };
  if (!conn.rescheduleOnMove) return { kind: "ignore", reason: "reschedule_on_move off" };
  if (!booking.staffId || booking.rentalUnitId) return { kind: "snapBack", notice: "spaces" };
  return { kind: "reschedule", startsAt: movedTo };
}

export type ApplyResult = { ok: true } | { ok: false; reason: "slotTaken" | "notFound" | "failed" };

export type InboundDeps = {
  client: GoogleCalendarClient;
  store: {
    loadBookingWithState(bookingId: string): Promise<{ booking: SyncBooking; state: SyncState } | null>;
    /** Put the mirror back: the outbound sync re-asserts the event. */
    requeue(bookingId: string, orgId: string): Promise<void>;
    /** `at` null = keep the cursor where it was (something in the batch failed). */
    markChecked(connectionId: string, at: Date | null, notice: string | null): Promise<void>;
  };
  apply: {
    cancel(booking: SyncBooking): Promise<ApplyResult>;
    reschedule(booking: SyncBooking, startsAt: Date): Promise<ApplyResult>;
  };
  /** Push + log for a refused move; best-effort. */
  notify: (conn: Connection, notice: string) => Promise<void>;
  now?: Date;
};

export type PollSummary = { seen: number; cancelled: number; rescheduled: number; snappedBack: number };

/** How far back a poll looks: the last check minus slack for clock skew
    and a notification that raced the previous poll; an hour on the first. */
export function pollSince(conn: Connection, now: Date): Date {
  const base = conn.inboundCheckedAt ?? new Date(now.getTime() - 60 * 60_000);
  return new Date(base.getTime() - 5 * 60_000);
}

export async function pollConnection(conn: Connection, deps: InboundDeps): Promise<PollSummary> {
  const now = deps.now ?? new Date();
  const summary: PollSummary = { seen: 0, cancelled: 0, rescheduled: 0, snappedBack: 0 };
  if (!conn.pushCalendarId || conn.status !== "active" || (!conn.cancelOnDelete && !conn.rescheduleOnMove)) return summary;

  const events = await deps.client.listEvents(conn.pushCalendarId, "", "", { updatedMin: pollSince(conn, now).toISOString(), showDeleted: true });
  let notice: string | null = null;
  // A batch with a failure keeps the cursor: Google's updatedMin filters
  // on the EVENT's timestamp, so an edit skipped now would never be
  // fetched again once the cursor moved past it.
  let failed = false;
  for (const event of events) {
    const marker = bookingIdOf(event);
    if (!marker) continue;
    summary.seen += 1;
    try {
      const row = await deps.store.loadBookingWithState(marker);
      const decision = classifyInbound(event, row?.booking ?? null, row?.state ?? null, conn);
      if (decision.kind === "ignore" || !row) continue;
      if (decision.kind === "cancel") {
        const r = await deps.apply.cancel(row.booking);
        if (r.ok) summary.cancelled += 1;
        continue;
      }
      let refused: string | null = null;
      if (decision.kind === "reschedule") {
        const r = await deps.apply.reschedule(row.booking, decision.startsAt);
        if (r.ok) {
          summary.rescheduled += 1;
          continue;
        }
        refused = r.reason;
      } else {
        refused = decision.notice;
      }
      // Refused: the mirror puts the event back where the booking is.
      await deps.store.requeue(row.booking.id, row.booking.orgId);
      summary.snappedBack += 1;
      notice = `${refused}:${row.booking.clientName}`;
      await deps.notify(conn, notice);
    } catch (error) {
      failed = true;
      console.error(`[calendar] inbound for booking ${marker} failed:`, error instanceof Error ? error.message : error);
    }
  }
  await deps.store.markChecked(conn.id, failed ? null : now, notice);
  return summary;
}
