"use server";

import { revalidatePath } from "next/cache";
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
import {
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingLifecycleKey,
  bookingConfirmationEmail,
  bookingManageLinkEmail,
  bookingIdempotencyKey,
  formatWhenLine,
  whenLineFor,
} from "./templates";
import { bookingTitle } from "./booking-label";
import {
  bookingIdInput,
  adminRescheduleInput,
  adminSlotsInput,
  adminCreateBookingInput,
  GENERIC_WRITE_ERROR,
} from "./schema";

const SLOT_TAKEN = "That time was just taken — please pick another.";
const OVERLAP = "That time overlaps an existing booking.";
// Team (multi-staff): the RPCs raise a bare `staff_unavailable` when the named
// person is inactive or isn't linked to the service. The dialogs only offer
// eligible people, so this is the "someone changed it in another tab" case.
const STAFF_UNAVAILABLE = "That team member doesn't offer this service.";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrg(): Promise<{ id: string; name: string; timezone: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone").limit(1).maybeSingle();
  return data ?? null;
}

export async function cancelBookingAdmin(
  input: unknown,
): Promise<
  { ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }
> {
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    // Column-scoped seam from 0028: only confirmed → cancelled_by_provider
    // can succeed; the org filter is defense-in-depth on top of RLS.
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .select(
        "id, client_name, client_email, staff_id, starts_at, ends_at, rental_unit_id, staff(name), services(name), rental_offerings(name), rental_units(name)",
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
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only a confirmed booking can be cancelled." };

    // Past this line the cancel is APPLIED — nothing below may turn into a
    // failed action, so the whole tail sits in its own catch rather than
    // falling through to the outer one (rescheduleBookingAdmin's precedent).
    let emailed = false;
    let noEmail = false;
    try {
      const serviceName = bookingTitle(row);
      const whenLine = whenLineFor(
        {
          startsAt: new Date(row.starts_at),
          endsAt: new Date(row.ends_at),
          isRental: row.rental_unit_id !== null,
        },
        org.timezone,
      );
      const idempotencyKey = bookingLifecycleKey(row.id, "cancelled");

      if (!row.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          const msg = bookingCancelledEmail({
            orgName: org.name,
            serviceName,
            whenLine,
            cancelledBy: "provider",
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
    return { ok: true, emailed, noEmail };
  } catch (error) {
    return fail("cancelBookingAdmin", error);
  }
}

export async function getAdminSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  const parsed = adminSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    // One person's grid: the walk-in and move dialogs both name whose slots
    // they are showing, so `perStaff` holds exactly that one member.
    const ctx = await loadOrgSlotContext(
      org.id,
      parsed.data.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
      { staffId: parsed.data.staffId },
    );
    if (!ctx) return { ok: false, error: STAFF_UNAVAILABLE };
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
  const parsed = adminRescheduleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, service_id, staff_id, client_name, client_email, starts_at")
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("rescheduleBookingAdmin", readError);
    if (!booking) return { ok: false, error: "Only a confirmed booking can be rescheduled." };
    // Rentals R1: a stay has no service and no slot grid — the appointment
    // engine below cannot speak for it. (The UI hides the button too.)
    if (booking.service_id === null) {
      return { ok: false, error: "Rental stays can't be moved here — cancel and rebook." };
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
    });
    // Null here means the target is not an active member offering this
    // service (deactivated, or the service unlinked, since the dialog
    // rendered) — the same condition the RPC would raise on.
    if (!ctx) return { ok: false, error: STAFF_UNAVAILABLE };
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
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
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
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      if (isRpcSentinel(error, "staff_unavailable")) {
        return { ok: false, error: STAFF_UNAVAILABLE };
      }
      return fail("rescheduleBookingAdmin", error);
    }
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
      const oldWhenLine = formatWhenLine(new Date(booking.starts_at), org.timezone);
      const whenLine = formatWhenLine(starts, org.timezone);
      // Keyed on the OLD id: the new id is not always in hand here, and
      // old-id + kind is just as collision-free.
      const idempotencyKey = bookingLifecycleKey(booking.id, "rescheduled");

      if (!booking.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          const msg = bookingRescheduledEmail({
            orgName: org.name,
            serviceName: ctx.service.name,
            oldWhenLine,
            whenLine,
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
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select(
        "id, client_email, starts_at, ends_at, rental_unit_id, staff(name), services(name), rental_offerings(name), rental_units(name)",
      )
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("resendManageLink", readError);
    if (!booking) return { ok: false, error: "Only a confirmed booking has a manage link." };
    if (!booking.client_email) {
      return { ok: false, error: "No email on file for this client.", noEmail: true };
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
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    };
    let emailed = true;
    try {
      const msg = bookingManageLinkEmail({
        orgName: org.name,
        serviceName: bookingTitle(row),
        whenLine: whenLineFor(
          {
            startsAt: new Date(row.starts_at),
            endsAt: new Date(row.ends_at),
            isRental: row.rental_unit_id !== null,
          },
          org.timezone,
        ),
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        canReschedule: row.rental_unit_id === null,
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
  const parsed = adminCreateBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
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
      if (error.code === "23P01") return { ok: false, error: OVERLAP, overlap: true };
      if (isRpcSentinel(error, "staff_unavailable")) {
        return { ok: false, error: STAFF_UNAVAILABLE };
      }
      return fail("createBookingAdmin", error);
    }
    // Past this line the booking EXISTS — nothing below may fail the action,
    // so the whole tail sits in its own catch rather than falling through to
    // the outer one (which returns `ok: false`).
    let emailed: "sent" | "failed" | "none" = "none";
    try {
      const whenLine = formatWhenLine(new Date(parsed.data.startsAt), org.timezone);
      const idempotencyKey = bookingIdempotencyKey(bookingId as string);
      const { data: svc } = await supabase
        .from("services").select("name").eq("id", parsed.data.serviceId).maybeSingle();
      const serviceName = svc?.name ?? "Appointment";

      if (parsed.data.email) {
        const { data: person } = await supabase
          .from("staff").select("name").eq("id", parsed.data.staffId).maybeSingle();
        try {
          const msg = bookingConfirmationEmail({
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
