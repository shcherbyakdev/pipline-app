// Confirmation email. Same discipline as chasing/templates.ts: the manage
// URL is the credential; org/service names and times only.

import type { RangeMode } from "@/features/rentals/range";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Team (multi-staff): client-facing mails name the staff member. Solo orgs
// pass null and the output stays byte-identical to the pre-team copy — the
// empty string keeps both the html newline and the text array element out.
const staffHtmlLine = (staffName?: string | null) =>
  staffName ? `\n  <p style="margin: 0 0 4px;">With ${esc(staffName)}</p>` : "";
const staffTextLine = (staffName?: string | null) =>
  staffName ? [`With ${staffName}`] : [];

// "Powered by Booklo" (spec §5): the growth loop on every client-facing mail.
// Whether it shows is a server decision (the org's plan and its embed toggle
// — lib/billing/queries.ts#emailBadgeUrl), so these take a ready URL, or null
// for "no badge". Same shape as the staff lines above: null keeps both the
// html newline and the text entries out, so a badge-less mail stays
// byte-identical to the pre-billing copy.
const badgeHtmlLine = (badgeUrl?: string | null) =>
  badgeUrl
    ? `\n  <p style="color: #999; font-size: 11px; margin: 12px 0 0;"><a href="${esc(badgeUrl)}" style="color: #999;">Powered by Booklo</a></p>`
    : "";
const badgeTextLines = (badgeUrl?: string | null) =>
  badgeUrl ? ["", `Powered by Booklo — ${badgeUrl}`] : [];

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

// Rentals (R1): a stay spans two instants, so the when-line carries both
// ends in the org zone with a single trailing tz suffix (repeating "CEST"
// on both halves reads as noise).
export function formatRangeWhenLine(starts: Date, ends: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const tz =
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(starts)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${f.format(starts)} → ${f.format(ends)} (${tz})`;
}

// Hourly rentals (H2): a booking spans two instants within one day, so the
// when-line is formatRangeWhenLine's construction with the date printed once
// and an en-dash time range instead of the arrow between two full dates.
export function formatHourlyWhenLine(starts: Date, ends: Date, timeZone: string): string {
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const tz =
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(starts)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${dateFmt.format(starts)}, ${timeFmt.format(starts)}–${timeFmt.format(ends)} (${tz})`;
}

// One call site for every email/page that renders a booking's time without
// caring which kind it is. `rangeMode` is optional and only read for a
// rental (H2: "hours" gets the single-day time-range phrasing instead of
// nights/days' two-date range) — every pre-H2 caller that never passes it
// keeps rendering exactly as before.
export function whenLineFor(
  b: { startsAt: Date; endsAt: Date; isRental: boolean; rangeMode?: RangeMode | null },
  timeZone: string,
): string {
  if (!b.isRental) return formatWhenLine(b.startsAt, timeZone);
  return b.rangeMode === "hours"
    ? formatHourlyWhenLine(b.startsAt, b.endsAt, timeZone)
    : formatRangeWhenLine(b.startsAt, b.endsAt, timeZone);
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending approval",
  declined: "Declined",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};

export function bookingConfirmationEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
  // H3: total / deposit / pay-at-venue / cancellation-policy lines. Absent
  // or empty renders byte-identical to the pre-H3 template.
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = `Booking confirmed — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking is confirmed.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above is your access to the booking.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking is confirmed.",
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
    ...badgeTextLines(input.badgeUrl),
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
  staffName?: string | null;
  badgeUrl?: string | null;
  // Rentals have no self-service reschedule — don't promise one (default:
  // appointments, which do).
  canReschedule?: boolean;
}): { subject: string; html: string; text: string } {
  const subject = `Your booking link — ${input.serviceName} with ${input.orgName}`;
  const verbs = input.canReschedule === false ? "view or cancel" : "view, reschedule, or cancel";
  const intro = `Here is a fresh link to ${verbs} your booking (${input.whenLine}). Any previous link no longer works.`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(intro)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above replaces any previous manage link.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    intro,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
    ...badgeTextLines(input.badgeUrl),
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
    // The provider's copy of a new public booking (0052).
    | "provider-new"
    // Team (multi-staff): an admin move that hands a booking to someone else
    // frees the OLD member's calendar — their notice needs a key of its own
    // so a later real cancellation isn't deduped against it.
    | "staff-handed-over"
    // Booking approval (0062): the client's request-received and
    // request-declined mails, and the accept-time confirmation's key (Task 7).
    | "request-received"
    | "request-declined"
    | "manage-accept"
    | `manage-${string}`,
): string {
  return `booking/${bookingId}/${kind}`;
}

export function bookingCancelledEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  cancelledBy: "client" | "provider";
  staffName?: string | null;
  badgeUrl?: string | null;
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
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Want to rebook? You can book again any time on the booking page.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    lead,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Approval: the request-time twin of bookingConfirmationEmail. No .ics —
// nothing is on anyone's calendar yet; the manage link is the withdraw path.
export function bookingRequestReceivedEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = `Request received — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking request was sent. You'll get an email once ${esc(input.orgName)} confirms it.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or withdraw this request</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above is your access to the request.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    `Your booking request was sent. You'll get an email once ${input.orgName} confirms it.`,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    "",
    `View or withdraw: ${input.manageUrl}`,
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function bookingDeclinedEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  note?: string | null;
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Request declined — ${input.serviceName}, ${input.whenLine}`;
  const noteHtml = input.note
    ? `\n  <p style="margin: 0 0 16px; color: #444; white-space: pre-wrap;">&ldquo;${esc(input.note)}&rdquo;</p>`
    : "";
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(input.orgName)} couldn't take your booking request.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${noteHtml}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    You're welcome to request another time on the booking page.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    `${input.orgName} couldn't take your booking request.`,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.note ? ["", `"${input.note}"`] : []),
    "",
    "You're welcome to request another time on the booking page.",
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function bookingRescheduledEmail(input: {
  orgName: string;
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Booking rescheduled — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking has been moved.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
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
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking has been moved.",
    input.serviceName,
    ...staffTextLine(input.staffName),
    `Was: ${input.oldWhenLine}`,
    `Now: ${input.whenLine}`,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
    ...badgeTextLines(input.badgeUrl),
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
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Reminder — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">A reminder about your upcoming booking.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Need to change or cancel? Use the link in your confirmation email.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "A reminder about your upcoming booking.",
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    "",
    "Need to change or cancel? Use the link in your confirmation email.",
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Staff-side "you have a new booking" notice. Deliberately link-free: the
// manage credential belongs to the client, and staff see the booking in the
// admin calendar. Mirrors providerCancelledEmail's plain shape.
export function staffNewBookingEmail(input: {
  staffName: string;
  orgName: string;
  serviceName: string;
  clientName: string;
  whenLine: string;
}): { subject: string; html: string; text: string } {
  const subject = `New booking — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">Hi ${esc(input.staffName)}, you have a new booking.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.clientName)}</strong></p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(input.orgName)}</p>
</div>`.trim();
  const text = [
    `Hi ${input.staffName}, you have a new booking.`,
    input.clientName,
    input.serviceName,
    input.whenLine,
    "",
    input.orgName,
  ].join("\n");
  return { subject, html, text };
}

// Provider-side "you have a new booking" — the org owner's copy of every
// public booking (audit 2026-08-24: solo providers got NOTHING when a client
// booked; staffNewBookingEmail only reaches a named team member). Link-free
// like the staff notice: the manage credential belongs to the client and the
// booking is in the admin calendar. Team orgs get the "With X" line.
export function providerNewBookingEmail(input: {
  serviceName: string;
  clientName: string;
  clientEmail: string;
  whenLine: string;
  staffName?: string | null;
  note?: string | null;
  // H3: same total / deposit / pay-at-venue / cancellation-policy lines as
  // the client confirmation. Absent or empty renders byte-identical to the
  // pre-H3 template.
  infoLines?: string[];
  // Approval (0062): the org requires approval and this booking landed
  // pending — the provider's copy reads "requested" and points at the
  // accept/decline step instead of the plain "booked" confirmation.
  pending?: boolean;
}): { subject: string; html: string; text: string } {
  const requested = input.pending === true;
  const subject = requested
    ? `New booking request — ${input.serviceName}, ${input.whenLine}`
    : `New booking — ${input.serviceName}, ${input.whenLine}`;
  const noteHtml = input.note
    ? `\n  <p style="margin: 0 0 16px; color: #444; white-space: pre-wrap;">${esc(input.note)}</p>`
    : "";
  const footer = requested
    ? "Accept or decline it from your Overview page — the slot is held until you do."
    : "It's on your calendar; the client got their confirmation.";
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;"><strong>${esc(input.clientName)}</strong> ${requested ? "requested a booking with you." : "booked with you."}</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 4px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 16px; color: #666;">${esc(input.clientEmail)}</p>${noteHtml}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(footer)}</p>
</div>`.trim();
  const text = [
    `${input.clientName} ${requested ? "requested a booking with you." : "booked with you."}`,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    input.clientEmail,
    ...(input.note ? ["", input.note] : []),
    "",
    footer,
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
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">The time is open again.</p>
</div>`.trim();
  const text = [
    `${input.clientName} cancelled their booking.`,
    input.serviceName,
    input.whenLine,
    "",
    "The time is open again.",
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
