"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { loadOrgSlotContext } from "@/lib/booking/public";
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
        "id, client_email, starts_at, ends_at, rental_unit_id, services(name), rental_offerings(name), rental_units(name)",
      );
    if (error) return fail("cancelBookingAdmin", error);
    const row = (data as unknown as Array<{
      id: string;
      client_email: string | null;
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only a confirmed booking can be cancelled." };

    let emailed = false;
    let noEmail = false;
    if (!row.client_email) {
      noEmail = true;
    } else {
      emailed = true;
      try {
        const msg = bookingCancelledEmail({
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
          cancelledBy: "provider",
        });
        await selectTransport().send({
          to: row.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(row.id, "cancelled"),
        });
      } catch (mailError) {
        console.error("[scheduling] admin cancel email failed:", mailError);
        emailed = false;
      }
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
    const ctx = await loadOrgSlotContext(
      org.id,
      parsed.data.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
    );
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
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
  | { ok: true; emailed: boolean; noEmail?: boolean }
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
      .select("id, service_id, client_email, starts_at")
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

    const starts = new Date(parsed.data.startsAt);
    const localDate = dateInZone(starts, org.timezone);
    const ctx = await loadOrgSlotContext(org.id, booking.service_id, localDate, 1, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const fresh = generateAccessToken();
    const { error } = await supabase.rpc("reschedule_booking_admin", {
      p_booking_id: booking.id,
      p_starts_at: starts.toISOString(),
      p_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      return fail("rescheduleBookingAdmin", error);
    }

    let emailed = false;
    let noEmail = false;
    if (!booking.client_email) {
      noEmail = true;
    } else {
      emailed = true;
      try {
        const msg = bookingRescheduledEmail({
          orgName: org.name,
          serviceName: ctx.service.name,
          oldWhenLine: formatWhenLine(new Date(booking.starts_at), org.timezone),
          whenLine: formatWhenLine(starts, org.timezone),
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        });
        await selectTransport().send({
          to: booking.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          // Keyed on the OLD id: the new id isn't returned with the email
          // fields, and old-id + kind is just as collision-free.
          idempotencyKey: bookingLifecycleKey(booking.id, "rescheduled"),
        });
      } catch (mailError) {
        console.error("[scheduling] admin reschedule email failed:", mailError);
        emailed = false;
      }
    }

    revalidatePath("/bookings");
    return { ok: true, emailed, noEmail };
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
        "id, client_email, starts_at, ends_at, rental_unit_id, services(name), rental_offerings(name), rental_units(name)",
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
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: OVERLAP, overlap: true };
      return fail("createBookingAdmin", error);
    }

    let emailed: "sent" | "failed" | "none" = "none";
    if (parsed.data.email) {
      const { data: svc } = await supabase
        .from("services").select("name").eq("id", parsed.data.serviceId).maybeSingle();
      try {
        const msg = bookingConfirmationEmail({
          orgName: org.name,
          serviceName: svc?.name ?? "Appointment",
          whenLine: formatWhenLine(new Date(parsed.data.startsAt), org.timezone),
          manageUrl: buildBookingManageUrl(token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        });
        await selectTransport().send({
          to: parsed.data.email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingIdempotencyKey(bookingId as string),
        });
        emailed = "sent";
      } catch (mailError) {
        console.error("[scheduling] admin create email failed:", mailError);
        emailed = "failed";
      }
    }

    revalidatePath("/bookings");
    return { ok: true, emailed };
  } catch (error) {
    return fail("createBookingAdmin", error);
  }
}
