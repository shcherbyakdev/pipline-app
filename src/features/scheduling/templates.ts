// Confirmation email. Same discipline as chasing/templates.ts: the manage
// URL is the credential; org/service names and times only.

import type { RangeMode } from "@/features/rentals/range";
import type { EmailsT } from "@/i18n/emails";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Every builder takes the org's `emails` translator first (i18n spec D4 —
// src/i18n/emails.ts builds it from orgs.locale); the copy below is keyed,
// the layout is not.

// Team (multi-staff): client-facing mails name the staff member. Solo orgs
// pass null and the output stays byte-identical to the pre-team copy — the
// empty string keeps both the html newline and the text array element out.
const staffHtmlLine = (t: EmailsT, staffName?: string | null) =>
  staffName ? `\n  <p style="margin: 0 0 4px;">${esc(t("with", { name: staffName }))}</p>` : "";
const staffTextLine = (t: EmailsT, staffName?: string | null) =>
  staffName ? [t("with", { name: staffName })] : [];

// "Powered by Booklo" (spec §5): the growth loop on every client-facing mail.
// Whether it shows is a server decision (the org's plan and its embed toggle
// — lib/billing/queries.ts#emailBadgeUrl), so these take a ready URL, or null
// for "no badge". Same shape as the staff lines above: null keeps both the
// html newline and the text entries out, so a badge-less mail stays
// byte-identical to the pre-billing copy.
const badgeHtmlLine = (t: EmailsT, badgeUrl?: string | null) =>
  badgeUrl
    ? `\n  <p style="color: #999; font-size: 11px; margin: 12px 0 0;"><a href="${esc(badgeUrl)}" style="color: #999;">${esc(t("poweredBy"))}</a></p>`
    : "";
const badgeTextLines = (t: EmailsT, badgeUrl?: string | null) =>
  badgeUrl ? ["", `${t("poweredBy")} — ${badgeUrl}`] : [];

export function bookingIdempotencyKey(bookingId: string): string {
  return `booking/${bookingId}/confirmation`;
}

// `intlLocale` is the Intl tag (INTL_LOCALES[locale], emailTranslators().intlLocale)
// — required, so no caller can silently fall back to English.
export function formatWhenLine(starts: Date, timeZone: string, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
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
export function formatRangeWhenLine(starts: Date, ends: Date, timeZone: string, intlLocale: string): string {
  const f = new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const tz =
    new Intl.DateTimeFormat(intlLocale, { timeZone, timeZoneName: "short" })
      .formatToParts(starts)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  return `${f.format(starts)} → ${f.format(ends)} (${tz})`;
}

// Hourly rentals (H2): a booking spans two instants within one day, so the
// when-line is formatRangeWhenLine's construction with the date printed once
// and an en-dash time range instead of the arrow between two full dates.
export function formatHourlyWhenLine(starts: Date, ends: Date, timeZone: string, intlLocale: string): string {
  const dateFmt = new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  });
  const timeFmt = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit", timeZone });
  const tz =
    new Intl.DateTimeFormat(intlLocale, { timeZone, timeZoneName: "short" })
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
  intlLocale: string,
): string {
  if (!b.isRental) return formatWhenLine(b.startsAt, timeZone, intlLocale);
  return b.rangeMode === "hours"
    ? formatHourlyWhenLine(b.startsAt, b.endsAt, timeZone, intlLocale)
    : formatRangeWhenLine(b.startsAt, b.endsAt, timeZone, intlLocale);
}

export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending approval",
  declined: "Declined",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};

export function bookingConfirmationEmail(t: EmailsT, input: {
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
  const subject = t("confirmation.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("confirmation.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">${esc(t("addToCalendar"))}</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">${esc(t("viewOrManage"))}</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("confirmation.keep"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    t("confirmation.lead"),
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    "",
    t("addToCalendarText", { url: input.icsUrl }),
    t("viewOrManageText", { url: input.manageUrl }),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Resend: a fresh manage link after token rotation. The old link is already
// dead by the time this is sent (rotation happens first) — the copy says so.
export function bookingManageLinkEmail(t: EmailsT, input: {
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
  // Approval: the booking is still a PENDING request. Nothing is on a
  // calendar yet, so the .ics goes (bookingRequestReceivedEmail's rule) and
  // the copy talks about a request, not a booking.
  request?: boolean;
}): { subject: string; html: string; text: string } {
  const names = { service: input.serviceName, orgName: input.orgName };
  const subject = input.request ? t("manageLink.subjectRequest", names) : t("manageLink.subjectBooking", names);
  const intro = input.request
    ? t("manageLink.introRequest", { when: input.whenLine })
    : input.canReschedule === false
      ? t("manageLink.introNoReschedule", { when: input.whenLine })
      : t("manageLink.intro", { when: input.whenLine });
  const icsHtml = input.request
    ? ""
    : `\n  <p style="margin: 0 0 8px;">\n    <a href="${esc(input.icsUrl)}">${esc(t("addToCalendar"))}</a>\n  </p>`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(intro)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${icsHtml}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">${esc(input.request ? t("viewOrWithdraw") : t("viewOrManage"))}</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("manageLink.keep"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    intro,
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    "",
    ...(input.request ? [] : [t("addToCalendarText", { url: input.icsUrl })]),
    t("viewOrManageText", { url: input.manageUrl }),
    ...badgeTextLines(t, input.badgeUrl),
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
    // Booking approval (0062): the client's request-declined mail, and the
    // accept-time confirmation's key (Task 7). The request-received mail
    // rides bookingIdempotencyKey instead — no lifecycle key for it.
    | "request-declined"
    | "manage-accept"
    | `manage-${string}`
    // S2 (0079): the hold's "pay by" mail, the webhook's confirmation, the
    // drain's release notice, the refund-after-the-fact notice.
    | "payment-due"
    | "payment-received"
    | "hold-expired"
    | "slot-lost",
): string {
  return `booking/${bookingId}/${kind}`;
}

/** "Mon 10 May, 11:32" in the org's zone — the hold deadline everywhere it prints. */
export function formatUntil(d: Date, timeZone: string, intlLocale: string): string {
  const day = new Intl.DateTimeFormat(intlLocale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat(intlLocale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${day}, ${time}`;
}

const infoHtml = (lines?: string[]) => (lines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("");

export function paymentDueEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; until: string; amount: string;
  payUrl: string; manageUrl: string; badgeUrl?: string | null; infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("paymentDue.subject", { amount: input.amount, until: input.until, service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("paymentDue.lead", { until: input.until }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${infoHtml(input.infoLines)}
  <p style="margin: 16px 0 8px;">
    <a href="${esc(input.payUrl)}" style="display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">${esc(t("paymentDue.pay", { amount: input.amount }))}</a>
  </p>
  <p style="margin: 0 0 8px;"><a href="${esc(input.manageUrl)}">${esc(t("viewOrWithdraw"))}</a></p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("paymentDue.keep"))}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("paymentDue.lead", { until: input.until }), input.serviceName, input.whenLine,
    ...(input.infoLines ?? []), "", t("paymentDue.payText", { amount: input.amount, url: input.payUrl }),
    t("viewOrWithdrawText", { url: input.manageUrl }), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function paymentReceivedEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; badgeUrl?: string | null; infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("paymentReceived.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("paymentReceived.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${infoHtml(input.infoLines)}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("paymentReceived.manageHint"))}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("paymentReceived.lead"), input.serviceName, input.whenLine, ...(input.infoLines ?? []), "",
    t("paymentReceived.manageHint"), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function holdExpiredEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; bookAgainUrl: string; badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = t("holdExpired.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("holdExpired.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;"><a href="${esc(input.bookAgainUrl)}">${esc(t("holdExpired.bookAgain"))}</a></p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName, "", t("holdExpired.lead"), input.serviceName, input.whenLine, "",
    t("holdExpired.bookAgainText", { url: input.bookAgainUrl }), ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function slotLostEmail(t: EmailsT, input: {
  orgName: string; serviceName: string; whenLine: string; amount: string; badgeUrl?: string | null;
  /** The refund did not go through: the studio owes it by hand, so the mail
      promises one rather than reporting one. */
  refundPending?: boolean;
}): { subject: string; html: string; text: string } {
  const subject = t("slotLost.subject", { service: input.serviceName, when: input.whenLine });
  const lead = input.refundPending
    ? t("slotLost.leadManual", { orgName: input.orgName, amount: input.amount })
    : t("slotLost.lead", { amount: input.amount });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(lead)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [input.orgName, "", lead, input.serviceName, input.whenLine, ...badgeTextLines(t, input.badgeUrl)].join("\n");
  return { subject, html, text };
}

export function bookingCancelledEmail(t: EmailsT, input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  cancelledBy: "client" | "provider";
  staffName?: string | null;
  badgeUrl?: string | null;
  // S2: the refund line, when money came back with the cancellation.
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const lead =
    input.cancelledBy === "client"
      ? t("cancelled.leadClient")
      : t("cancelled.leadProvider", { orgName: input.orgName });
  const subject = t("cancelled.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(lead)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${infoHtml(input.infoLines)}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("cancelled.rebook"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    lead,
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Approval: the request-time twin of bookingConfirmationEmail. No .ics —
// nothing is on anyone's calendar yet; the manage link is the withdraw path.
export function bookingRequestReceivedEmail(t: EmailsT, input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("requestReceived.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("requestReceived.lead", { orgName: input.orgName }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">${esc(t("viewOrWithdraw"))}</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("requestReceived.keep"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    t("requestReceived.lead", { orgName: input.orgName }),
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    "",
    t("viewOrWithdrawText", { url: input.manageUrl }),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function bookingDeclinedEmail(t: EmailsT, input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  note?: string | null;
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = t("declined.subject", { service: input.serviceName, when: input.whenLine });
  const noteHtml = input.note
    ? `\n  <p style="margin: 0 0 16px; color: #444; white-space: pre-wrap;">${esc(t("quoted", { note: input.note }))}</p>`
    : "";
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("declined.lead", { orgName: input.orgName }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${noteHtml}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("declined.again"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    t("declined.lead", { orgName: input.orgName }),
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    ...(input.note ? ["", t("quoted", { note: input.note })] : []),
    "",
    t("declined.again"),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function bookingRescheduledEmail(t: EmailsT, input: {
  orgName: string;
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
  // S1: the moved booking is re-quoted at its new time, so the money lines
  // are the NEW row's snapshot. Absent or empty renders byte-identical to
  // the pre-S1 template.
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = t("rescheduled.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("rescheduled.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">${esc(t("addToCalendar"))}</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">${esc(t("viewOrManage"))}</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("rescheduled.keep"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    t("rescheduled.lead"),
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    t("was", { when: input.oldWhenLine }),
    t("now", { when: input.whenLine }),
    ...(input.infoLines ?? []),
    "",
    t("addToCalendarText", { url: input.icsUrl }),
    t("viewOrManageText", { url: input.manageUrl }),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Deliberately link-free: only the token HASH is stored, so the manage URL
// cannot be reconstructed at drain time. The confirmation email carries
// the credential.
export function bookingReminderEmail(t: EmailsT, input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = t("reminder.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(t("reminder.lead"))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    ${esc(t("reminder.change"))}
  </p>${badgeHtmlLine(t, input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    t("reminder.lead"),
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    "",
    t("reminder.change"),
    ...badgeTextLines(t, input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

// Staff-side "you have a new booking" notice. Deliberately link-free: the
// manage credential belongs to the client, and staff see the booking in the
// admin calendar. Mirrors providerCancelledEmail's plain shape.
export function staffNewBookingEmail(t: EmailsT, input: {
  staffName: string;
  orgName: string;
  serviceName: string;
  clientName: string;
  whenLine: string;
}): { subject: string; html: string; text: string } {
  const subject = t("staffNew.subject", { service: input.serviceName, when: input.whenLine });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">${esc(t("staffNew.lead", { name: input.staffName }))}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.clientName)}</strong></p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(input.orgName)}</p>
</div>`.trim();
  const text = [
    t("staffNew.lead", { name: input.staffName }),
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
export function providerNewBookingEmail(t: EmailsT, input: {
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
  const subject = requested ? t("providerNew.subjectRequest", { service: input.serviceName, when: input.whenLine }) : t("providerNew.subject", { service: input.serviceName, when: input.whenLine });
  // The client's name is bold in html, plain in text — one sentence, two
  // renderings (t.markup resolves the <b> tag).
  const leadKey = requested ? "providerNew.leadRequest" : "providerNew.lead";
  const leadHtml = t.markup(leadKey, { client: esc(input.clientName), b: (c) => `<strong>${c}</strong>` });
  const leadText = t.markup(leadKey, { client: input.clientName, b: (c) => c });
  const noteHtml = input.note
    ? `\n  <p style="margin: 0 0 16px; color: #444; white-space: pre-wrap;">${esc(input.note)}</p>`
    : "";
  const footer = requested ? t("providerNew.footerRequest") : t("providerNew.footer");
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">${leadHtml}</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>${staffHtmlLine(t, input.staffName)}
  <p style="margin: 0 0 4px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 16px; color: #666;">${esc(input.clientEmail)}</p>${noteHtml}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(footer)}</p>
</div>`.trim();
  const text = [
    leadText,
    input.serviceName,
    ...staffTextLine(t, input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    input.clientEmail,
    ...(input.note ? ["", input.note] : []),
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}

export function providerCancelledEmail(t: EmailsT, input: {
  serviceName: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = t("providerCancelled.subject", { service: input.serviceName, when: input.whenLine });
  const leadHtml = t.markup("providerCancelled.lead", { client: esc(input.clientName), b: (c) => `<strong>${c}</strong>` });
  const leadText = t.markup("providerCancelled.lead", { client: input.clientName, b: (c) => c });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">${leadHtml}</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">${esc(t("providerCancelled.open"))}</p>
</div>`.trim();
  const text = [
    leadText,
    input.serviceName,
    input.whenLine,
    "",
    t("providerCancelled.open"),
  ].join("\n");
  return { subject, html, text };
}

export function providerRescheduledEmail(t: EmailsT, input: {
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = t("providerRescheduled.subject", { service: input.serviceName, when: input.whenLine });
  const leadHtml = t.markup("providerRescheduled.lead", { client: esc(input.clientName), b: (c) => `<strong>${c}</strong>` });
  const leadText = t.markup("providerRescheduled.lead", { client: input.clientName, b: (c) => c });
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;">${leadHtml}</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>
</div>`.trim();
  const text = [
    leadText,
    input.serviceName,
    t("was", { when: input.oldWhenLine }),
    t("now", { when: input.whenLine }),
  ].join("\n");
  return { subject, html, text };
}
