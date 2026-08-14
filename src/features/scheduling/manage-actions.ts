"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { resolveBookingToken, buildBookingManageUrl } from "@/lib/tokens/booking";
import { loadOrgSlotContext } from "@/lib/booking/public";
import { getProviderEmail } from "@/lib/booking/provider";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone } from "./slots";
import {
  bookingCancelledEmail,
  bookingRescheduledEmail,
  providerCancelledEmail,
  providerRescheduledEmail,
  bookingLifecycleKey,
  formatWhenLine,
} from "./templates";
import {
  manageSlotsInput,
  manageTokenInput,
  rescheduleBookingInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

const SLOT_TAKEN = "That time was just taken — please pick another.";
const NOT_CHANGEABLE = "This booking can no longer be changed online.";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Token-authenticated resolve for mutations/pickers: only a confirmed,
// still-future booking is actionable (mirrors the RPCs' own guards).
async function resolveActionable(token: string) {
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok") return null;
  const { booking } = result;
  if (booking.status !== "confirmed") return null;
  if (booking.startsAt.getTime() <= Date.now()) return null;
  return booking;
}

export async function getManageSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = manageSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const booking = await resolveActionable(parsed.data.token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };
    const ctx = await loadOrgSlotContext(
      booking.orgId,
      booking.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
      { excludeBookingId: booking.id },
    );
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate: parsed.data.fromDate,
      days: parsed.data.days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getManageSlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function cancelBooking(input: unknown): Promise<ActionState> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = manageTokenInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const anon = createAnonServerClient();
    const { data, error } = await anon.rpc("cancel_booking", { p_token: parsed.data.token });
    if (error) {
      console.error("[scheduling] cancelBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const row = (data as Array<{
      booking_id: string;
      org_id: string;
      org_name: string;
      org_timezone: string;
      service_name: string;
      client_name: string;
      client_email: string;
      starts_at: string;
    }> | null)?.[0];
    if (!row) return { ok: false, error: NOT_CHANGEABLE };

    // Best-effort notifications — the cancellation is already committed.
    try {
      const transport = selectTransport();
      const whenLine = formatWhenLine(new Date(row.starts_at), row.org_timezone);
      const msg = bookingCancelledEmail({
        orgName: row.org_name,
        serviceName: row.service_name,
        whenLine,
        cancelledBy: "client",
      });
      await transport.send({
        to: row.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(row.booking_id, "cancelled"),
      });
      const providerEmail = await getProviderEmail(row.org_id);
      if (providerEmail) {
        const notice = providerCancelledEmail({
          serviceName: row.service_name,
          whenLine,
          clientName: row.client_name,
        });
        await transport.send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          idempotencyKey: bookingLifecycleKey(row.booking_id, "provider-cancelled"),
        });
      }
    } catch (mailError) {
      console.error("[scheduling] cancel emails failed:", mailError);
    }
    return { ok: true };
  } catch (error) {
    console.error("[scheduling] cancelBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function rescheduleBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = rescheduleBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const booking = await resolveActionable(parsed.data.token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };

    // Engine re-check on the org-local day (createBooking idiom): the
    // requested instant must be one of the engine's own outputs. EXCLUDE +
    // the RPC's containment stay the race-proof last lines.
    const starts = new Date(parsed.data.startsAt);
    const localDate = dateInZone(starts, booking.orgTimezone);
    const ctx = await loadOrgSlotContext(booking.orgId, booking.serviceId, localDate, 1, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const fresh = generateAccessToken();
    const anon = createAnonServerClient();
    const { data, error } = await anon.rpc("reschedule_booking", {
      p_token: parsed.data.token,
      p_starts_at: starts.toISOString(),
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      console.error("[scheduling] rescheduleBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const row = (data as Array<{
      new_booking_id: string;
      org_id: string;
      org_name: string;
      org_timezone: string;
      service_name: string;
      client_name: string;
      client_email: string;
      old_starts_at: string;
      new_starts_at: string;
    }> | null)?.[0];
    if (!row) return { ok: false, error: NOT_CHANGEABLE };

    try {
      const transport = selectTransport();
      const oldWhenLine = formatWhenLine(new Date(row.old_starts_at), row.org_timezone);
      const whenLine = formatWhenLine(new Date(row.new_starts_at), row.org_timezone);
      const msg = bookingRescheduledEmail({
        orgName: row.org_name,
        serviceName: row.service_name,
        oldWhenLine,
        whenLine,
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
      });
      await transport.send({
        to: row.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(row.new_booking_id, "rescheduled"),
      });
      const providerEmail = await getProviderEmail(row.org_id);
      if (providerEmail) {
        const notice = providerRescheduledEmail({
          serviceName: row.service_name,
          oldWhenLine,
          whenLine,
          clientName: row.client_name,
        });
        await transport.send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          idempotencyKey: bookingLifecycleKey(row.new_booking_id, "provider-rescheduled"),
        });
      }
    } catch (mailError) {
      console.error("[scheduling] reschedule emails failed:", mailError);
    }

    return { ok: true, token: fresh.token };
  } catch (error) {
    console.error("[scheduling] rescheduleBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
