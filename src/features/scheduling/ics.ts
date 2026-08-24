// Minimal RFC 5545 VEVENT for the "add to calendar" download. All times
// UTC (Z suffix) — calendar apps localize on import.

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function bookingIcs(input: {
  // The ROOT of the booking's reschedule chain (audit 2026-08-24): a
  // reschedule inserts a new row, and a UID that followed the row id made
  // calendar apps keep the stale event next to the new one. Same UID +
  // a higher SEQUENCE is how they know to replace it.
  uid: string;
  starts: Date;
  ends: Date;
  summary: string;
  description: string;
  url: string;
  // Team orgs name the staff member in the event title; solo orgs pass
  // null/undefined and the SUMMARY is unchanged.
  staffName?: string | null;
  // Reschedule depth (0 for the original booking).
  sequence?: number;
  // A cancelled booking still answers — as a cancellation, so an app that
  // re-fetches the link drops the event instead of 404ing.
  cancelled?: boolean;
  // Injected for tests; "now" otherwise (DTSTAMP is when the file was made).
  now?: Date;
}): string {
  const summary = input.staffName ? `${input.summary} with ${input.staffName}` : input.summary;
  const uid = input.uid.includes("@") ? input.uid : `${input.uid}@booklo.co`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Booklo//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(input.starts)}`,
    `DTEND:${icsStamp(input.ends)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `URL:${input.url}`,
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
