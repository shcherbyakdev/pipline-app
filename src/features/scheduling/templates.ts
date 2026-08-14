// Confirmation email. Same discipline as chasing/templates.ts: the manage
// URL is the credential; org/service names and times only.

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function bookingIdempotencyKey(bookingId: string): string {
  return `booking/${bookingId}/confirmation`;
}

export function formatWhenLine(starts: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(starts);
}

export function bookingConfirmationEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Booking confirmed — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking is confirmed.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above is your access to the booking.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking is confirmed.",
    input.serviceName,
    input.whenLine,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
  ].join("\n");
  return { subject, html, text };
}
