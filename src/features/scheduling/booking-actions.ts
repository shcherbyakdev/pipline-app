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
  formatWhenLine,
} from "./templates";
import {
  bookingIdInput,
  adminRescheduleInput,
  adminSlotsInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

const SLOT_TAKEN = "That time was just taken — pick another.";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrg(): Promise<{ id: string; name: string; timezone: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone").limit(1).maybeSingle();
  return data ?? null;
}

export async function cancelBookingAdmin(input: unknown): Promise<ActionState> {
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
      .select("id, client_email, starts_at, services(name)");
    if (error) return fail("cancelBookingAdmin", error);
    const row = (data as unknown as Array<{
      id: string;
      client_email: string;
      starts_at: string;
      services: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only an upcoming confirmed booking can be cancelled." };

    try {
      const msg = bookingCancelledEmail({
        orgName: org.name,
        serviceName: row.services?.name ?? "Appointment",
        whenLine: formatWhenLine(new Date(row.starts_at), org.timezone),
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
    }

    revalidatePath("/bookings");
    return { ok: true };
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
): Promise<{ ok: true } | { ok: false; error: string; slotTaken?: boolean }> {
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
    }

    revalidatePath("/bookings");
    return { ok: true };
  } catch (error) {
    return fail("rescheduleBookingAdmin", error);
  }
}
