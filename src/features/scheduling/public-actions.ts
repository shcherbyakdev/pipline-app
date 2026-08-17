"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingOrg,
  loadOrgSlotContext,
  countActiveStaff,
  resolveClientStaffName,
} from "@/lib/booking/public";
import { sendStaffNotice } from "@/lib/booking/staff-notice";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone, unionSlots } from "./slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  formatWhenLine,
} from "./templates";
import { getSlotsInput, createBookingInput, GENERIC_WRITE_ERROR } from "./schema";
import { SLOT_TAKEN, slotLostMessage } from "./booking-errors";


async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// slotLostMessage (booking-errors.ts) holds the rule; this only feeds it the
// count. "any" short-circuits so the common case costs no query, and a count
// that blows up degrades to the solo wording — never to copy about a team the
// org may not have.
async function slotLostError(orgId: string, staffId: string): Promise<string> {
  if (staffId === "any") return SLOT_TAKEN;
  try {
    return slotLostMessage(staffId, await countActiveStaff(orgId));
  } catch (error) {
    console.error("[scheduling] countActiveStaff:", error);
    return SLOT_TAKEN;
  }
}

// Shared by both actions: everything the engine needs for one org+service,
// per eligible staff member. `staffId: "any"` fans out across every staff
// member who offers the service; a named id narrows to that one.
async function loadSlotContext(
  handle: string,
  serviceId: string,
  fromDate: string,
  days: number,
  staffId: string,
) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const ctx = await loadOrgSlotContext(org.orgId, serviceId, fromDate, days, { staffId });
  if (!ctx) return null;
  return { org, service: ctx.service, perStaff: ctx.perStaff };
}

// The engine runs once per eligible staff member; the client sees the union
// (a time is offered if ANYONE can take it). Auto-assign happens in the RPC,
// which re-checks availability under the EXCLUDE constraint.
function slotsPerStaff(
  ctx: NonNullable<Awaited<ReturnType<typeof loadSlotContext>>>,
  fromDate: string,
  days: number,
) {
  const now = new Date();
  return ctx.perStaff.map((p) => ({
    staffId: p.staffId,
    slots: computeSlots({
      service: ctx.service,
      rules: p.rules,
      exceptions: p.exceptions,
      busy: p.busy,
      timeZone: ctx.org.timeZone,
      now,
      fromDate,
      days,
    }),
  }));
}

export async function getSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = getSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, fromDate, days, staffId } = parsed.data;
  try {
    const ctx = await loadSlotContext(handle, serviceId, fromDate, days, staffId);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = unionSlots(slotsPerStaff(ctx, fromDate, days));
    return { ok: true, slots: slots.map((s) => s.startsAt.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getSlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function createBooking(
  input: unknown,
): Promise<
  | { ok: true; token: string; staffName: string | null }
  | { ok: false; error: string; slotTaken?: boolean }
> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = createBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, startsAt, name, email, note, staffId } = parsed.data;

  try {
    const starts = new Date(startsAt);
    const ctx = await loadSlotContext(handle, serviceId, dateInZone(starts, "UTC"), 2, staffId);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };

    // Re-run the engine for the org-local day of the requested slot; the
    // requested instant must be in the union of the eligible staff's outputs.
    // The EXCLUDE constraint remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = unionSlots(slotsPerStaff(ctx, localDate, 1));
    if (!slots.some((s) => s.startsAt.getTime() === starts.getTime())) {
      return {
        ok: false,
        error: await slotLostError(ctx.org.orgId, staffId),
        slotTaken: true,
      };
    }

    const { token, tokenHash } = generateAccessToken();
    const anon = createAnonServerClient();
    const { data, error } = await anon.rpc("create_booking", {
      p_handle: handle,
      p_service_id: serviceId,
      p_starts_at: starts.toISOString(),
      p_name: name,
      p_email: email,
      p_note: note ?? null,
      p_token_hash: tokenHash,
      p_staff_id: staffId === "any" ? null : staffId,
    });
    if (error) {
      // The RPC raises a bare `staff_unavailable` when a NAMED staff member
      // cannot take the slot; `taken`/23P01 is the classic race. Solo orgs
      // reach the first branch too (they send a named id), so the wording is
      // decided by the same count as the pre-flight check above.
      if (error.message?.includes("staff_unavailable")) {
        return { ok: false, error: await slotLostError(ctx.org.orgId, staffId), slotTaken: true };
      }
      if (error.message?.includes("taken") || error.code === "23P01") {
        return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      }
      console.error("[scheduling] createBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    // create_booking RETURNS TABLE — one row of (booking_id, staff_id, staff_name).
    const row = (data as unknown as
      | { booking_id: string; staff_id: string; staff_name: string }[]
      | null)?.[0];
    if (!row) {
      console.error("[scheduling] createBooking: rpc returned no row");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Solo orgs never name a staff member (resolveClientStaffName holds that
    // rule, and degrades to the unnamed copy if the count blows up — past this
    // point the booking EXISTS and nothing may fail the action).
    const staffName = await resolveClientStaffName(ctx.org.orgId, row.staff_name);
    const whenLine = formatWhenLine(starts, ctx.org.timeZone);
    const idempotencyKey = bookingIdempotencyKey(row.booking_id);

    // Best-effort confirmation (spec: the booking survives email failure;
    // S2's drain adds retries).
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = bookingConfirmationEmail({
        orgName: ctx.org.orgName,
        serviceName: ctx.service.name,
        whenLine,
        manageUrl,
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        staffName,
      });
      await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey,
      });
    } catch (mailError) {
      console.error("[scheduling] confirmation email failed:", mailError);
    }

    // Staff-side heads-up (never throws, swallows its own errors). Solo orgs
    // are unaffected: sendStaffNotice itself skips orgs with <= 1 active staff,
    // where the provider notice already says the same thing.
    await sendStaffNotice({
      orgId: ctx.org.orgId,
      staffId: row.staff_id,
      kind: "new",
      serviceName: ctx.service.name,
      clientName: name,
      whenLine,
      idempotencyKey,
    });

    return { ok: true, token, staffName };
  } catch (error) {
    console.error("[scheduling] createBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
