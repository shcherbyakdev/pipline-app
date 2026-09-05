import type { GoogleEventBody } from "@/lib/google/calendar";
import { dateInZone } from "@/features/scheduling/slots";

/* Pure: a booking row → the Google event that mirrors it (spec 2026-09-05
   §2.10, v2 decision 16). With `inviteClients` the client is a guest —
   Google mails them the invitation from the owner's account, on top of
   Booklo's own confirmation, which is what Calendly does. The private
   extended property is how the busy reader recognises our own events and
   leaves them out, and how the inbound poll matches a Google edit back to
   its booking. */

export type SyncBooking = {
  id: string;
  orgId: string;
  status: string;
  staffId: string | null;
  rentalUnitId: string | null;
  startsAt: string;
  endsAt: string;
  clientName: string;
  clientEmail: string | null;
  note: string | null;
  /** Service name, or the space · unit title (bookingTitle). */
  title: string;
  timeZone: string;
};

export const BOOKLO_MARKER = "bookloBookingId";

/** Google event ids must be base32hex (0-9, a-v), 5–1024 chars: a uuid
    without its dashes qualifies, and being derived from the booking it
    makes every insert idempotent. */
export function eventIdFor(bookingId: string): string {
  return bookingId.replace(/-/g, "").toLowerCase();
}

/** The inverse, for events Google hands back stripped to their id (a
    deleted event is "only guaranteed to have the id field populated"):
    32 hex chars → the booking uuid, anything else → null. */
export function bookingIdFromEventId(eventId: string): string | null {
  const m = /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(eventId);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}` : null;
}

export function buildEventBody(b: SyncBooking, appUrl: string, opts: { inviteClient?: boolean } = {}): GoogleEventBody {
  const day = dateInZone(new Date(b.startsAt), b.timeZone);
  const lines = [b.clientEmail, b.note].filter((x): x is string => Boolean(x));
  if (lines.length) lines.push("");
  lines.push("Booked through Booklo", `${appUrl}/bookings?date=${day}`);
  const guest = opts.inviteClient && b.clientEmail ? [{ email: b.clientEmail, displayName: b.clientName }] : [];
  return {
    id: eventIdFor(b.id),
    summary: `${b.clientName} — ${b.title}`,
    description: lines.join("\n"),
    start: { dateTime: new Date(b.startsAt).toISOString(), timeZone: b.timeZone },
    end: { dateTime: new Date(b.endsAt).toISOString(), timeZone: b.timeZone },
    extendedProperties: { private: { [BOOKLO_MARKER]: b.id } },
    reminders: { useDefault: true },
    ...(guest.length ? { attendees: guest, guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false } : {}),
  };
}
