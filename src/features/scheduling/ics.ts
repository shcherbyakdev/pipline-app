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
  // Team orgs name the staff member in the event title; solo orgs pass
  // null/undefined and the SUMMARY is unchanged.
  staffName?: string | null;
}): string {
  const summary = input.staffName ? `${input.summary} with ${input.staffName}` : input.summary;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RolloutOS//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.starts)}`,
    `DTSTART:${icsStamp(input.starts)}`,
    `DTEND:${icsStamp(input.ends)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `URL:${input.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
