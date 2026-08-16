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

// Resend: a fresh manage link after token rotation. The old link is already
// dead by the time this is sent (rotation happens first) — the copy says so.
export function bookingManageLinkEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your booking link — ${input.serviceName} with ${input.orgName}`;
  const intro = `Here is a fresh link to view, reschedule, or cancel your booking (${input.whenLine}). Any previous link no longer works.`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(intro)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above replaces any previous manage link.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    intro,
    input.serviceName,
    input.whenLine,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
  ].join("\n");
  return { subject, html, text };
}

export function bookingLifecycleKey(
  bookingId: string,
  // `manage-${hash8}` is emitted per token rotation (resend) — widened here
  // rather than adding a sibling helper, since the format is still just
  // "booking/<id>/<kind>".
  kind:
    | "cancelled"
    | "rescheduled"
    | "reminder"
    | "provider-cancelled"
    | "provider-rescheduled"
    | `manage-${string}`,
): string {
  return `booking/${bookingId}/${kind}`;
}

export function bookingCancelledEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  cancelledBy: "client" | "provider";
}): { subject: string; html: string; text: string } {
  const lead =
    input.cancelledBy === "client"
      ? "Your booking has been cancelled as requested."
      : `${input.orgName} had to cancel your booking.`;
  const subject = `Booking cancelled — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(lead)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Need a new appointment? Book again any time on the booking page.
  </p>
</div>`.trim();
  const text = [input.orgName, "", lead, input.serviceName, input.whenLine].join("\n");
  return { subject, html, text };
}

export function bookingRescheduledEmail(input: {
  orgName: string;
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Booking rescheduled — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking has been moved.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above replaces your previous manage link.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking has been moved.",
    input.serviceName,
    `Was: ${input.oldWhenLine}`,
    `Now: ${input.whenLine}`,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
  ].join("\n");
  return { subject, html, text };
}

// Deliberately link-free: only the token HASH is stored, so the manage URL
// cannot be reconstructed at drain time. The confirmation email carries
// the credential.
export function bookingReminderEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
}): { subject: string; html: string; text: string } {
  const subject = `Reminder — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">A reminder about your upcoming appointment.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Need to change or cancel? Use the link in your confirmation email.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "A reminder about your upcoming appointment.",
    input.serviceName,
    input.whenLine,
    "",
    "Need to change or cancel? Use the link in your confirmation email.",
  ].join("\n");
  return { subject, html, text };
}

export function providerCancelledEmail(input: {
  serviceName: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Cancelled by client — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;"><strong>${esc(input.clientName)}</strong> cancelled their booking.</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">The slot is open again.</p>
</div>`.trim();
  const text = [
    `${input.clientName} cancelled their booking.`,
    input.serviceName,
    input.whenLine,
    "",
    "The slot is open again.",
  ].join("\n");
  return { subject, html, text };
}

export function providerRescheduledEmail(input: {
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Rescheduled by client — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;"><strong>${esc(input.clientName)}</strong> moved their booking.</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>
</div>`.trim();
  const text = [
    `${input.clientName} moved their booking.`,
    input.serviceName,
    `Was: ${input.oldWhenLine}`,
    `Now: ${input.whenLine}`,
  ].join("\n");
  return { subject, html, text };
}
