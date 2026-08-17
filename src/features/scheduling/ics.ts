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
  uid: string;
  starts: Date;
  ends: Date;
  summary: string;
  description: string;
  url: string;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Booklo//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.starts)}`,
    `DTSTART:${icsStamp(input.starts)}`,
    `DTEND:${icsStamp(input.ends)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `URL:${input.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
