import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailTranslators } from "@/i18n/emails";
import { clientMailCopy } from "@/lib/booking/client-locale";
import { loadOrgSlotContext, resolveClientStaffName } from "@/lib/booking/public";
import { sendStaffNotice } from "@/lib/booking/staff-notice";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { selectTransport } from "@/lib/email/transport";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { computeSlots, dateInZone } from "@/features/scheduling/slots";
import { bookingCancelledEmail, bookingLifecycleKey, bookingRescheduledEmail, formatWhenLine, whenLineFor } from "@/features/scheduling/templates";
import { bookingTitle } from "@/features/scheduling/booking-label";
import type { RangeMode } from "@/features/rentals/range";
import type { SyncBooking } from "./event-body";
import type { ApplyResult } from "./inbound";

/* The two things a Google edit can do to a booking (spec v2 decision 17),
   done the way the admin does them — same status transition, same client
   mail, same staff notice — but with no session: the owner acted in
   Google, and the connection's own row already tied the event to this
   booking. Each returns a result, never throws past the mail tail. */

type OrgRow = { id: string; name: string; timezone: string; locale: string };

const BOOKING_MAIL_COLUMNS =
  "id, org_id, client_name, client_email, staff_id, starts_at, ends_at, rental_unit_id, locale, staff(name), services(name), rental_offerings(name, range_mode), rental_units(name)";

type MailRow = {
  id: string;
  org_id: string;
  client_name: string;
  client_email: string | null;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  rental_unit_id: string | null;
  locale: string | null;
  staff: { name: string } | null;
  services: { name: string } | null;
  rental_offerings: { name: string; range_mode: RangeMode | null } | null;
  rental_units: { name: string } | null;
};

async function orgFor(db: SupabaseClient, orgId: string): Promise<OrgRow | null> {
  const { data } = await db.from("orgs").select("id, name, timezone, locale").eq("id", orgId).maybeSingle();
  return data ?? null;
}

/** cancelBookingAdmin's write and mail tail without the session. */
export async function applyGoogleCancel(booking: SyncBooking, db: SupabaseClient = createAdminClient()): Promise<ApplyResult> {
  const { data, error } = await db
    .from("bookings")
    .update({ status: "cancelled_by_provider" })
    .eq("id", booking.id)
    .eq("org_id", booking.orgId)
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString())
    .select(BOOKING_MAIL_COLUMNS);
  if (error) {
    console.error("[calendar] inbound cancel failed:", error);
    return { ok: false, reason: "failed" };
  }
  const row = (data as unknown as MailRow[] | null)?.[0];
  if (!row) return { ok: false, reason: "notFound" };

  try {
    const org = await orgFor(db, booking.orgId);
    if (!org) return { ok: true };
    const mail = await emailTranslators(org.locale);
    const serviceName = bookingTitle(row, mail.t("appointment"));
    const whenLine = whenLineFor(
      { startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), isRental: row.rental_unit_id !== null },
      org.timezone,
      mail.intlLocale,
    );
    const idempotencyKey = bookingLifecycleKey(row.id, "cancelled");
    if (row.client_email) {
      const forClient = await clientMailCopy(row, org);
      const msg = bookingCancelledEmail(forClient.t, {
        orgName: org.name,
        serviceName: forClient.serviceName,
        whenLine: forClient.whenLine,
        cancelledBy: "provider",
        staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
        badgeUrl: await emailBadgeUrl(org.id),
      });
      await selectTransport().send({ to: row.client_email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey });
    }
    if (row.staff_id) {
      await sendStaffNotice({ orgId: org.id, staffId: row.staff_id, kind: "cancelled", serviceName, clientName: row.client_name, whenLine, idempotencyKey });
    }
  } catch (postError) {
    console.error("[calendar] inbound cancel follow-up failed:", postError);
  }
  return { ok: true };
}

/** rescheduleBookingAdmin without the session: the same engine pre-check
    (the booking excluded, Google read fresh), the system RPC, the same
    client mail with a new manage link. Appointments only — the caller
    snaps a moved stay back. */
export async function applyGoogleReschedule(booking: SyncBooking, startsAt: Date, db: SupabaseClient = createAdminClient()): Promise<ApplyResult> {
  const { data: current, error: readError } = await db
    .from("bookings")
    .select("id, service_id, staff_id, client_name, client_email, starts_at, locale")
    .eq("id", booking.id)
    .eq("org_id", booking.orgId)
    .eq("status", "confirmed")
    .maybeSingle();
  if (readError) {
    console.error("[calendar] inbound reschedule read failed:", readError);
    return { ok: false, reason: "failed" };
  }
  if (!current?.service_id || !current.staff_id) return { ok: false, reason: "notFound" };
  const org = await orgFor(db, booking.orgId);
  if (!org) return { ok: false, reason: "notFound" };

  const localDate = dateInZone(startsAt, org.timezone);
  const ctx = await loadOrgSlotContext(org.id, current.service_id, localDate, 1, {
    staffId: current.staff_id,
    excludeBookingId: current.id,
    includeInactive: true,
    freshExternal: true,
  });
  if (!ctx) return { ok: false, reason: "notFound" };
  const slots = computeSlots({
    service: ctx.service,
    rules: ctx.perStaff[0].rules,
    exceptions: ctx.perStaff[0].exceptions,
    busy: ctx.perStaff[0].busy,
    timeZone: org.timezone,
    now: new Date(),
    fromDate: localDate,
    days: 1,
  });
  if (!slots.some((s) => s.getTime() === startsAt.getTime())) return { ok: false, reason: "slotTaken" };

  const fresh = generateAccessToken();
  const { data, error } = await db.rpc("reschedule_booking_system", {
    p_booking_id: current.id,
    p_starts_at: startsAt.toISOString(),
    p_token_hash: fresh.tokenHash,
  });
  if (error) {
    if (error.code === "23P01") return { ok: false, reason: "slotTaken" };
    if (isRpcSentinel(error, "not found") || isRpcSentinel(error, "staff_unavailable")) return { ok: false, reason: "notFound" };
    console.error("[calendar] inbound reschedule failed:", error);
    return { ok: false, reason: "failed" };
  }
  const row = (data as { new_booking_id: string; staff_name: string }[] | null)?.[0];

  try {
    const mail = await emailTranslators(org.locale);
    const oldWhenLine = formatWhenLine(new Date(current.starts_at), org.timezone, mail.intlLocale);
    const whenLine = formatWhenLine(startsAt, org.timezone, mail.intlLocale);
    const idempotencyKey = bookingLifecycleKey(row?.new_booking_id ?? current.id, "rescheduled");
    if (current.client_email) {
      const client = await emailTranslators(current.locale ?? org.locale);
      const msg = bookingRescheduledEmail(client.t, {
        orgName: org.name,
        serviceName: ctx.service.name,
        oldWhenLine: formatWhenLine(new Date(current.starts_at), org.timezone, client.intlLocale),
        whenLine: formatWhenLine(startsAt, org.timezone, client.intlLocale),
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        staffName: await resolveClientStaffName(org.id, row?.staff_name ?? null),
        badgeUrl: await emailBadgeUrl(org.id),
      });
      await selectTransport().send({ to: current.client_email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey });
    }
    await sendStaffNotice({
      orgId: org.id,
      staffId: current.staff_id,
      kind: "rescheduled",
      serviceName: ctx.service.name,
      clientName: current.client_name,
      whenLine,
      oldWhenLine,
      idempotencyKey,
    });
  } catch (postError) {
    console.error("[calendar] inbound reschedule follow-up failed:", postError);
  }
  return { ok: true };
}
