"use server";

import { emailTranslators } from "@/i18n/emails";
import { clientMailCopy } from "@/lib/booking/client-locale";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { createClient } from "@/lib/supabase/server";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { loadOrgSlotContext, resolveClientStaffName } from "@/lib/booking/public";
import { sendStaffNotice } from "@/lib/booking/staff-notice";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone } from "./slots";
import { moneyInfoLines } from "@/features/rentals/pricing";
import { refundBooking } from "@/features/payments/refund";
import type { Line } from "@/features/rentals/pricing-rules";
import type { RangeMode } from "@/features/rentals/range";
import { formatMoney } from "@/lib/money";
import {
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingDeclinedEmail,
  bookingLifecycleKey,
  bookingConfirmationEmail,
  bookingManageLinkEmail,
  bookingIdempotencyKey,
  formatUntil,
  formatWhenLine,
  paymentDueEmail,
  whenLineFor,
} from "./templates";
import { bookingTitle } from "./booking-label";
import {
  bookingIdInput,
  bookingCancelInput,
  declineBookingInput,
  adminRescheduleInput,
  adminSlotsInput,
  adminCreateBookingInput,
} from "./schema";

// Every refusal is an `errors.*` key resolved in the admin's language (i18n
// Wave 3): each action takes `t` up front, and fail() — the generic write
// error after a logged failure — resolves its own. Team (multi-staff): the
// RPCs raise a bare `staff_unavailable` when the named person is inactive or
// isn't linked to the service; the dialogs only offer eligible people, so
// that is the "someone changed it in another tab" case (staffNotOffering).
async function fail(context: string, error: unknown): Promise<{ ok: false; error: string }> {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: (await getTranslations("errors"))("generic") };
}

async function currentOrg(): Promise<{ id: string; name: string; timezone: string; locale: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone, locale").limit(1).maybeSingle();
  return data ?? null;
}

export async function cancelBookingAdmin(
  input: unknown,
): Promise<
  | { ok: true; emailed: boolean; noEmail?: boolean; refundedCents: number; refundFailed: boolean }
  | { ok: false; error: string }
> {
  const t = await getTranslations("errors");
  const parsed = bookingCancelInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    // Column-scoped seam from 0028: only confirmed | pending_payment →
    // cancelled_by_provider can succeed (S2 widened the policy to holds —
    // the studio can drop one before the client pays); the org filter is
    // defense-in-depth on top of RLS. Future only: a booking that has
    // already started is history, and the client would otherwise get a "had
    // to cancel" email about an appointment that happened (the RPCs behind
    // reschedule/resend already refuse the past).
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .in("status", ["confirmed", "pending_payment"])
      .gt("starts_at", new Date().toISOString())
      .select(
        "id, client_name, client_email, staff_id, starts_at, ends_at, rental_unit_id, locale, currency, staff(name), services(name), rental_offerings(name), rental_units(name)",
      );
    if (error) return fail("cancelBookingAdmin", error);
    const row = (data as unknown as Array<{
      id: string;
      client_name: string;
      client_email: string | null;
      staff_id: string | null;
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      locale: string | null;
      currency: string | null;
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: t("bookings.notCancellable") };
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    // S2 (ruling 3): the cancel refunds in full unless the dialog said not
    // to. Best effort and recorded on the ledger — a failure is finished by
    // hand in Stripe and never fails the cancel, which is already applied.
    const refund =
      parsed.data.refund === false
        ? { refundedCents: 0, failed: false }
        : await refundBooking(row.id, "admin-cancel").catch((e) => {
            console.error("[payments] admin cancel refund:", e);
            return { refundedCents: 0, failed: true };
          });

    // Past this line the cancel is APPLIED — nothing below may turn into a
    // failed action, so the whole tail sits in its own catch rather than
    // falling through to the outer one (rescheduleBookingAdmin's precedent).
    let emailed = false;
    let noEmail = false;
    try {
      const mail = await emailTranslators(org.locale);
      // The staff member's half — always the org's language.
      const serviceName = bookingTitle(row, mail.t("appointment"));
      const whenLine = whenLineFor(
        {
          startsAt: new Date(row.starts_at),
          endsAt: new Date(row.ends_at),
          isRental: row.rental_unit_id !== null,
        },
        org.timezone,
        mail.intlLocale,
      );
      // The client's half — the language they booked in (0072).
      const forClient = await clientMailCopy(row, org);
      const idempotencyKey = bookingLifecycleKey(row.id, "cancelled");

      if (!row.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          const msg = bookingCancelledEmail(forClient.t, {
            orgName: org.name,
            serviceName: forClient.serviceName,
            whenLine: forClient.whenLine,
            cancelledBy: "provider",
            // S2: what came back, in the client's own language. Built here,
            // inside the mail's own try — the cancel is already applied.
            infoLines:
              refund.refundedCents > 0 && row.currency
                ? [
                    forClient.tUnits("refund", {
                      amount: formatMoney(refund.refundedCents, row.currency),
                    }),
                  ]
                : undefined,
            // Solo orgs never name a staff member — resolveClientStaffName is
            // the one place that rule lives (and swallows its own errors).
            staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
            // Badge unless the plan lets the org hide it and it did
            // (emailBadgeUrl swallows its own errors, same as above).
            badgeUrl: await emailBadgeUrl(org.id),
          });
          await selectTransport().send({
            to: row.client_email,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            idempotencyKey,
          });
        } catch (mailError) {
          console.error("[scheduling] admin cancel email failed:", mailError);
          emailed = false;
        }
      }

      // Team: the freed slot is the assigned member's. Outside the try above so
      // a failed client mail cannot skip it; the notice swallows its own errors
      // and no-ops on a solo org. Rentals carry no staff_id at all.
      if (row.staff_id) {
        await sendStaffNotice({
          orgId: org.id,
          staffId: row.staff_id,
          kind: "cancelled",
          serviceName,
          clientName: row.client_name,
          whenLine,
          idempotencyKey,
        });
      }
    } catch (postError) {
      console.error("[scheduling] admin cancel follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    return { ok: true, emailed, noEmail, refundedCents: refund.refundedCents, refundFailed: refund.failed };
  } catch (error) {
    return fail("cancelBookingAdmin", error);
  }
}

export async function getAdminSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const parsed = adminSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    // One person's grid: the walk-in and move dialogs both name whose slots
    // they are showing, so `perStaff` holds exactly that one member. The
    // service may be deactivated (hidden from the public page) and still have
    // bookings the admin needs to move — hence includeInactive.
    const ctx = await loadOrgSlotContext(
      org.id,
      parsed.data.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
      { staffId: parsed.data.staffId, includeInactive: true },
    );
    if (!ctx) return { ok: false, error: t("bookings.staffNotOffering") };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.perStaff[0].rules,
      exceptions: ctx.perStaff[0].exceptions,
      busy: ctx.perStaff[0].busy,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: parsed.data.fromDate,
      days: parsed.data.days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    return fail("getAdminSlots", error);
  }
}

export async function rescheduleBookingAdmin(
  input: unknown,
): Promise<
  | { ok: true; emailed: boolean; noEmail?: boolean; movedToStaffName?: string | null }
  | { ok: false; error: string; slotTaken?: boolean }
> {
  const t = await getTranslations("errors");
  const parsed = adminRescheduleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, service_id, staff_id, client_name, client_email, starts_at, locale")
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("rescheduleBookingAdmin", readError);
    if (!booking) return { ok: false, error: t("bookings.notReschedulable") };
    // Rentals R1: a stay has no service and no slot grid — the appointment
    // engine below cannot speak for it. (The UI hides the button too.)
    if (booking.service_id === null) {
      return { ok: false, error: t("bookings.stayNotReschedulable") };
    }
    // Team (multi-staff): a move may also hand the booking to someone else.
    // Everything below — the engine re-check included — is about the TARGET
    // person; `staffId` omitted keeps the current one (the RPC's own rule).
    const targetStaffId = parsed.data.staffId ?? booking.staff_id;
    if (!targetStaffId) return fail("rescheduleBookingAdmin", "booking has no staff");

    const starts = new Date(parsed.data.startsAt);
    const localDate = dateInZone(starts, org.timezone);
    const ctx = await loadOrgSlotContext(org.id, booking.service_id, localDate, 1, {
      staffId: targetStaffId,
      excludeBookingId: booking.id,
      // A deactivated service keeps its future bookings; moving one must not
      // fail as "doesn't offer this service" (public pages still hide it).
      includeInactive: true,
    });
    // Null here means the target is not an active member offering this
    // service (deactivated, or the service unlinked, since the dialog
    // rendered) — the same condition the RPC would raise on.
    if (!ctx) return { ok: false, error: t("bookings.staffNotOffering") };
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
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: t("slotTaken"), slotTaken: true };
    }

    const fresh = generateAccessToken();
    const { data, error } = await supabase.rpc("reschedule_booking_admin", {
      p_booking_id: booking.id,
      p_starts_at: starts.toISOString(),
      p_token_hash: fresh.tokenHash,
      // null = "keep the current person" (0041's own default).
      p_staff_id: parsed.data.staffId ?? null,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: t("slotTaken"), slotTaken: true };
      if (isRpcSentinel(error, "staff_unavailable")) {
        return { ok: false, error: t("bookings.staffNotOffering") };
      }
      return fail("rescheduleBookingAdmin", error);
    }
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)
    // Past this line the move is COMMITTED — nothing below may turn into a
    // failed action, so the whole tail sits in its own catch rather than
    // falling through to the outer one (which returns `ok: false`).
    let emailed = false;
    let noEmail = false;
    let movedToStaffName: string | null = null;
    try {
      // reschedule_booking_admin RETURNS TABLE: one row of
      // (new_booking_id, staff_changed, staff_name).
      const row = (data as unknown as
        | { new_booking_id: string; staff_changed: boolean; staff_name: string }[]
        | null)?.[0];
      if (!row) console.error("[scheduling] rescheduleBookingAdmin: rpc returned no row");
      movedToStaffName = row?.staff_changed ? row.staff_name : null;
      const mail = await emailTranslators(org.locale);
      const oldWhenLine = formatWhenLine(new Date(booking.starts_at), org.timezone, mail.intlLocale);
      const whenLine = formatWhenLine(starts, org.timezone, mail.intlLocale);
      // The client's language (0072); the staff notices below keep `mail`.
      const client = await emailTranslators(booking.locale ?? org.locale);
      const clientOldWhenLine = formatWhenLine(new Date(booking.starts_at), org.timezone, client.intlLocale);
      const clientWhenLine = formatWhenLine(starts, org.timezone, client.intlLocale);
      // Keyed on the NEW id, never the old one. A reschedule writes a new row,
      // so "booking/<old>/rescheduled" is NOT collision-free: after a client
      // move A→B, an admin move B→C would reuse B's key with a different
      // payload — Resend answers 409 and the client never gets the C link.
      // The new id is minted once, so its key is fresh by construction; the
      // fallback only covers an RPC that returned no row (logged above).
      const idempotencyKey = bookingLifecycleKey(row?.new_booking_id ?? booking.id, "rescheduled");

      if (!booking.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          const msg = bookingRescheduledEmail(client.t, {
            orgName: org.name,
            serviceName: ctx.service.name,
            oldWhenLine: clientOldWhenLine,
            whenLine: clientWhenLine,
            manageUrl: buildBookingManageUrl(fresh.token),
            icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
            // Solo orgs never name a staff member — resolveClientStaffName is
            // the one place that rule lives (and swallows its own errors).
            staffName: await resolveClientStaffName(org.id, row?.staff_name ?? null),
            badgeUrl: await emailBadgeUrl(org.id),
          });
          await selectTransport().send({
            to: booking.client_email,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            idempotencyKey,
          });
        } catch (mailError) {
          console.error("[scheduling] admin reschedule email failed:", mailError);
          emailed = false;
        }
      }

      // Team: the calendar that changed belongs to the target member. Outside
      // the try above so a failed client mail cannot skip it; the notice
      // swallows its own errors and no-ops on a solo org.
      //
      // On a HAND-OFF the target had nothing on their calendar before, so
      // "moved from X to Y" is copy about a slot they never held — for them it
      // is a new booking. Only a same-person move reads as a reschedule.
      // (`oldWhenLine` is ignored by the "new" template.)
      const handedOff = row?.staff_changed === true;
      await sendStaffNotice({
        orgId: org.id,
        staffId: targetStaffId,
        kind: handedOff ? "new" : "rescheduled",
        serviceName: ctx.service.name,
        clientName: booking.client_name,
        whenLine,
        oldWhenLine,
        idempotencyKey,
      });
      // A hand-off frees the old member's calendar — for them it reads as a
      // cancellation. Its own key: a later real cancellation of this booking
      // must not be deduped against this one.
      if (handedOff && booking.staff_id) {
        await sendStaffNotice({
          orgId: org.id,
          staffId: booking.staff_id,
          kind: "cancelled",
          serviceName: ctx.service.name,
          clientName: booking.client_name,
          whenLine: oldWhenLine,
          idempotencyKey: bookingLifecycleKey(booking.id, "staff-handed-over"),
        });
      }
    } catch (postError) {
      console.error("[scheduling] admin reschedule follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    return { ok: true, emailed, noEmail, movedToStaffName };
  } catch (error) {
    return fail("rescheduleBookingAdmin", error);
  }
}

export async function resendManageLink(
  input: unknown,
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string; noEmail?: boolean }> {
  const t = await getTranslations("errors");
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select(
        "id, status, client_email, starts_at, ends_at, rental_unit_id, locale, staff(name), services(name), rental_offerings(name), rental_units(name)",
      )
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      // A pending request's link is the client's only handle on it, so it
      // reissues like a confirmed booking's (rotate_booking_token, 0064).
      .in("status", ["confirmed", "pending"])
      .maybeSingle();
    if (readError) return fail("resendManageLink", readError);
    if (!booking) return { ok: false, error: t("bookings.noManageLink") };
    if (!booking.client_email) {
      return { ok: false, error: t("bookings.noEmail"), noEmail: true };
    }

    // Rotate first — the old link is dead the moment this succeeds, whether
    // or not the send below works. Don't reorder.
    const fresh = generateAccessToken();
    const { error } = await supabase.rpc("rotate_booking_token", {
      p_booking_id: booking.id,
      p_token_hash: fresh.tokenHash,
    });
    if (error) return fail("resendManageLink", error);

    const row = booking as unknown as {
      status: string;
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      locale: string | null;
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    };
    let emailed = true;
    try {
      // Only the client gets a manage link, so there is one language here:
      // the one they booked in (0072).
      const forClient = await clientMailCopy(row, org);
      const msg = bookingManageLinkEmail(forClient.t, {
        orgName: org.name,
        serviceName: forClient.serviceName,
        whenLine: forClient.whenLine,
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        canReschedule: row.rental_unit_id === null,
        // A request has nothing on a calendar yet — the template drops the
        // .ics and says "request" throughout.
        request: row.status === "pending",
        // Same copy the client already has from the confirmation: a resent link
        // must not silently drop who the appointment is with. Solo orgs → null
        // (resolveClientStaffName), rentals have no staff at all.
        staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
        badgeUrl: await emailBadgeUrl(org.id),
      });
      await selectTransport().send({
        to: booking.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        // Keyed per rotation (hash prefix) — resending later must not be
        // deduped against the previous send.
        idempotencyKey: bookingLifecycleKey(booking.id, `manage-${fresh.tokenHash.slice(0, 8)}`),
      });
    } catch (mailError) {
      console.error("[scheduling] resend manage link email failed:", mailError);
      emailed = false;
    }
    return { ok: true, emailed };
  } catch (error) {
    return fail("resendManageLink", error);
  }
}

export async function createBookingAdmin(
  input: unknown,
): Promise<{ ok: true; emailed: "sent" | "failed" | "none" } | { ok: false; error: string; overlap?: boolean }> {
  const t = await getTranslations("errors");
  const parsed = adminCreateBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { token, tokenHash } = generateAccessToken();
    const { data: bookingId, error } = await supabase.rpc("create_booking_admin", {
      p_service_id: parsed.data.serviceId,
      p_starts_at: parsed.data.startsAt,
      p_name: parsed.data.name,
      p_email: parsed.data.email ?? null,
      p_note: parsed.data.note ?? null,
      p_token_hash: tokenHash,
      p_duration_min: parsed.data.durationMin ?? null,
      // Team (multi-staff): required by the RPC — a walk-in belongs to
      // someone. Solo orgs send their one member's id.
      p_staff_id: parsed.data.staffId,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: t("bookings.overlap"), overlap: true };
      if (isRpcSentinel(error, "staff_unavailable")) {
        return { ok: false, error: t("bookings.staffNotOffering") };
      }
      return fail("createBookingAdmin", error);
    }
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)
    // Past this line the booking EXISTS — nothing below may fail the action,
    // so the whole tail sits in its own catch rather than falling through to
    // the outer one (which returns `ok: false`).
    let emailed: "sent" | "failed" | "none" = "none";
    try {
      const mail = await emailTranslators(org.locale);
      const whenLine = formatWhenLine(new Date(parsed.data.startsAt), org.timezone, mail.intlLocale);
      const idempotencyKey = bookingIdempotencyKey(bookingId as string);
      const { data: svc } = await supabase
        .from("services").select("name").eq("id", parsed.data.serviceId).maybeSingle();
      const serviceName = svc?.name ?? mail.t("appointment");

      if (parsed.data.email) {
        const { data: person } = await supabase
          .from("staff").select("name").eq("id", parsed.data.staffId).maybeSingle();
        try {
          const msg = bookingConfirmationEmail(mail.t, {
            orgName: org.name,
            serviceName,
            whenLine,
            manageUrl: buildBookingManageUrl(token),
            icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
            // Solo orgs never name a staff member (resolveClientStaffName).
            staffName: await resolveClientStaffName(org.id, person?.name ?? null),
            badgeUrl: await emailBadgeUrl(org.id),
          });
          await selectTransport().send({
            to: parsed.data.email,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            idempotencyKey,
          });
          emailed = "sent";
        } catch (mailError) {
          console.error("[scheduling] admin create email failed:", mailError);
          emailed = "failed";
        }
      }

      // Staff-side heads-up: a walk-in the provider booked still lands on
      // someone else's calendar. Swallows its own errors; no-ops on a solo org.
      await sendStaffNotice({
        orgId: org.id,
        staffId: parsed.data.staffId,
        kind: "new",
        serviceName,
        clientName: parsed.data.name,
        whenLine,
        idempotencyKey,
      });
    } catch (postError) {
      console.error("[scheduling] admin create follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    return { ok: true, emailed };
  } catch (error) {
    return fail("createBookingAdmin", error);
  }
}

// ---- Booking approval (0062/0063): the provider's answer to a request.
//
// Neither flip can be a plain UPDATE: 0028's provider seam grants
// `authenticated` only bookings.status, under a policy pinned to
// confirmed → cancelled_by_provider, and decline_note has no column grant at
// all. Both actions therefore call a definer RPC (0063) and then RE-READ the
// row for the email tail. The RPC is the commit point — everything after it
// follows cancelBookingAdmin's committed-tail discipline.

// Both RPCs raise a bare 'not found' for every guard they hold (not this
// org's row / not pending / already started), so the action cannot tell
// them apart — one friendly line (errors.bookings.notPending*) covers all.

export async function acceptBookingRequest(
  input: unknown,
): Promise<{ ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    // pending -> confirmed cannot 23P01: the row already holds its slot under
    // the widened EXCLUDE (0062). Guards (live pending, this org) are the RPC's.
    const { error: rpcError } = await supabase.rpc("accept_booking", {
      p_booking_id: parsed.data.id,
    });
    if (rpcError) {
      // Only the RPC's own bare sentinel means "a guard refused it". A
      // transport error, a PostgREST 5xx or a PGRST202 (function missing after
      // a partial deploy) arrives as `{ error }` too, and must not be
      // relabelled as a resolved request — fail() logs the whole thing.
      return isRpcSentinel(rpcError, "not found")
        ? { ok: false, error: t("bookings.notPendingAccept") }
        : fail("acceptBookingRequest", rpcError);
    }
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    // Past this line the accept is COMMITTED — nothing below may turn into a
    // failed action, so the whole tail (the re-read included) sits in its own
    // catch rather than falling through to the outer one.
    let emailed = false;
    let noEmail = false;
    try {
      const { data: rows, error: readError } = await supabase
        .from("bookings")
        .select(
          "id, status, hold_expires_at, client_name, client_email, staff_id, starts_at, ends_at, rental_unit_id, locale, price_cents, currency, deposit_cents, lines, staff(name), services(name), rental_offerings(name, range_mode, cancel_window_min), rental_units(name)",
        )
        .eq("id", parsed.data.id)
        .eq("org_id", org.id);
      if (readError) console.error("[scheduling] acceptBookingRequest read:", readError);
      const row = (rows as unknown as Array<{
        id: string;
        status: string;
        hold_expires_at: string | null;
        client_name: string;
        client_email: string | null;
        staff_id: string | null;
        starts_at: string;
        ends_at: string;
        rental_unit_id: string | null;
        locale: string | null;
        price_cents: number | null;
        currency: string | null;
        deposit_cents: number | null;
        lines: unknown;
        staff: { name: string } | null;
        services: { name: string } | null;
        rental_offerings: { name: string; range_mode: RangeMode; cancel_window_min: number } | null;
        rental_units: { name: string } | null;
      }> | null)?.[0];
      // No row = the read failed after a committed accept: no mail can go
      // out, and the action still reports success.
      if (!row) {
        noEmail = true;
      } else {
        // S2 (0079): the RPC may have HELD the row instead of confirming it —
        // the client then gets "pay by", not the confirmation.
        const held = row.status === "pending_payment" && row.hold_expires_at !== null;
        const mail = await emailTranslators(org.locale);
        // The staff notice below is the org's; the confirmation is the
        // client's, in the language they booked in (0072).
        const serviceName = bookingTitle(row, mail.t("appointment"));
        const whenLine = whenLineFor(
          {
            startsAt: new Date(row.starts_at),
            endsAt: new Date(row.ends_at),
            isRental: row.rental_unit_id !== null,
            rangeMode: row.rental_offerings?.range_mode ?? null,
          },
          org.timezone,
          mail.intlLocale,
        );
        const forClient = await clientMailCopy(row, org);
        const idempotencyKey = bookingLifecycleKey(row.id, "manage-accept");

        if (!row.client_email) {
          noEmail = true;
        } else {
          // Rotate first (resendManageLink discipline): the confirmation must
          // carry a live link, and the request-received link dies with it.
          const fresh = generateAccessToken();
          const { error: rotateError } = await supabase.rpc("rotate_booking_token", {
            p_booking_id: row.id,
            p_token_hash: fresh.tokenHash,
          });
          if (rotateError) {
            // Accepted but not rotated: the old (request) link still works.
            // Skip the mail; "Resend link" recovers.
            console.error("[scheduling] accept rotate failed:", rotateError);
          } else {
            emailed = true;
            try {
              const infoLines =
                row.rental_unit_id !== null
                  ? moneyInfoLines(
                      {
                        totalCents: row.price_cents,
                        depositCents: row.deposit_cents,
                        currency: row.currency,
                        cancelWindowMin: row.rental_offerings?.cancel_window_min ?? 0,
                        // S1: the row's own quote breakdown; S2: "pay now"
                        // rather than "pay at the venue" while it is held.
                        lines: (row.lines as Line[] | null) ?? null,
                        holding: held,
                      },
                      forClient.tUnits,
                    )
                  : [];
              // The pay link carries the FRESH token — the request link died
              // with the rotation above.
              const manageUrl = buildBookingManageUrl(fresh.token);
              const msg =
                held && row.deposit_cents !== null && row.currency
                  ? paymentDueEmail(forClient.t, {
                      orgName: org.name,
                      serviceName: forClient.serviceName,
                      whenLine: forClient.whenLine,
                      until: formatUntil(new Date(row.hold_expires_at!), org.timezone, forClient.intlLocale),
                      amount: formatMoney(row.deposit_cents, row.currency),
                      payUrl: `${manageUrl}/pay`,
                      manageUrl,
                      badgeUrl: await emailBadgeUrl(org.id),
                      infoLines,
                    })
                  : bookingConfirmationEmail(forClient.t, {
                      orgName: org.name,
                      serviceName: forClient.serviceName,
                      whenLine: forClient.whenLine,
                      manageUrl,
                      icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
                      staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
                      badgeUrl: await emailBadgeUrl(org.id),
                      infoLines,
                    });
              await selectTransport().send({
                to: row.client_email,
                subject: msg.subject,
                html: msg.html,
                text: msg.text,
                idempotencyKey,
              });
            } catch (mailError) {
              console.error("[scheduling] accept email failed:", mailError);
              emailed = false;
            }
          }
        }

        // The member finally hears about it — creating a pending row
        // deliberately skipped the staff notice (Task 5).
        if (row.staff_id) {
          await sendStaffNotice({
            orgId: org.id,
            staffId: row.staff_id,
            kind: "new",
            serviceName,
            clientName: row.client_name,
            whenLine,
            idempotencyKey,
          });
        }
      }
    } catch (postError) {
      console.error("[scheduling] accept follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true, emailed, noEmail };
  } catch (error) {
    return fail("acceptBookingRequest", error);
  }
}

export async function declineBookingRequest(
  input: unknown,
): Promise<{ ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const parsed = declineBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    // The RPC stores the note (nullif(btrim(...), '')) — decline_note carries
    // no column grant, so the action never writes it itself.
    const { error: rpcError } = await supabase.rpc("decline_booking", {
      p_booking_id: parsed.data.id,
      p_note: parsed.data.note ?? null,
    });
    if (rpcError) {
      // Sentinel-only mapping, same reasoning as accept above.
      return isRpcSentinel(rpcError, "not found")
        ? { ok: false, error: t("bookings.notPendingDecline") }
        : fail("declineBookingRequest", rpcError);
    }
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    // Committed from here — same discipline as accept above: the re-read
    // included, nothing below may fail the action.
    let emailed = false;
    let noEmail = false;
    try {
      const { data: rows, error: readError } = await supabase
        .from("bookings")
        .select(
          "id, client_email, starts_at, ends_at, rental_unit_id, locale, staff(name), services(name), rental_offerings(name, range_mode), rental_units(name)",
        )
        .eq("id", parsed.data.id)
        .eq("org_id", org.id);
      if (readError) console.error("[scheduling] declineBookingRequest read:", readError);
      const row = (rows as unknown as Array<{
        id: string;
        client_email: string | null;
        starts_at: string;
        ends_at: string;
        rental_unit_id: string | null;
        locale: string | null;
        staff: { name: string } | null;
        services: { name: string } | null;
        rental_offerings: { name: string; range_mode: RangeMode } | null;
        rental_units: { name: string } | null;
      }> | null)?.[0];

      if (!row?.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          // Only the client hears about a decline, so there is one language
          // here: theirs (0072).
          const forClient = await clientMailCopy(row, org);
          const msg = bookingDeclinedEmail(forClient.t, {
            orgName: org.name,
            serviceName: forClient.serviceName,
            whenLine: forClient.whenLine,
            // The provider's own words, straight from the parsed input — the
            // RPC stored the same value (trimmed) in decline_note.
            note: parsed.data.note ?? null,
            staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
            badgeUrl: await emailBadgeUrl(org.id),
          });
          await selectTransport().send({
            to: row.client_email,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            idempotencyKey: bookingLifecycleKey(row.id, "request-declined"),
          });
        } catch (mailError) {
          console.error("[scheduling] decline email failed:", mailError);
          emailed = false;
        }
      }
    } catch (postError) {
      console.error("[scheduling] decline follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true, emailed, noEmail };
  } catch (error) {
    return fail("declineBookingRequest", error);
  }
}
