"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { getBookingOrg, loadOrgSlotContext } from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone } from "./slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  formatWhenLine,
} from "./templates";
import { getSlotsInput, createBookingInput, GENERIC_WRITE_ERROR } from "./schema";

const SLOT_TAKEN = "That time was just taken — please pick another.";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Shared by both actions: everything the engine needs for one org+service.
async function loadSlotContext(handle: string, serviceId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const ctx = await loadOrgSlotContext(org.orgId, serviceId, fromDate, days);
  if (!ctx) return null;
  return { org, ...ctx };
}

export async function getSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = getSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, fromDate, days } = parsed.data;
  try {
    const ctx = await loadSlotContext(handle, serviceId, fromDate, days);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: ctx.org.timeZone,
      now: new Date(),
      fromDate,
      days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getSlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function createBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = createBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, startsAt, name, email, note } = parsed.data;

  try {
    const starts = new Date(startsAt);
    const ctx = await loadSlotContext(handle, serviceId, dateInZone(starts, "UTC"), 2);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };

    // Re-run the engine for the org-local day of the requested slot; the
    // requested instant must be one of its outputs. The EXCLUDE constraint
    // remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: ctx.org.timeZone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const { token, tokenHash } = generateAccessToken();
    const anon = createAnonServerClient();
    const { data: bookingId, error } = await anon.rpc("create_booking", {
      p_handle: handle,
      p_service_id: serviceId,
      p_starts_at: starts.toISOString(),
      p_name: name,
      p_email: email,
      p_note: note ?? null,
      p_token_hash: tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      console.error("[scheduling] createBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Best-effort confirmation (spec: the booking survives email failure;
    // S2's drain adds retries).
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = bookingConfirmationEmail({
        orgName: ctx.org.orgName,
        serviceName: ctx.service.name,
        whenLine: formatWhenLine(starts, ctx.org.timeZone),
        manageUrl,
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
      });
      await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingIdempotencyKey(bookingId as string),
      });
    } catch (mailError) {
      console.error("[scheduling] confirmation email failed:", mailError);
    }

    return { ok: true, token };
  } catch (error) {
    console.error("[scheduling] createBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
