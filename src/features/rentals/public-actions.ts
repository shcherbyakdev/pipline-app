"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingOrg,
  getBookingUnitName,
  getPublicOfferingById,
  loadOrgRangeContext,
  type PublicUnit,
} from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  formatRangeWhenLine,
} from "@/features/scheduling/templates";
import {
  computeRangeAvailability,
  stayLength,
  validateStay,
  type RangeAvailability,
} from "./range";
import {
  getRangeAvailabilityInput,
  createRentalBookingInput,
  CHECK_IN_PASSED,
  DATES_TAKEN,
  GENERIC_WRITE_ERROR,
} from "./schema";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Shared by both actions: org + everything the range engine needs.
async function loadRangeContext(handle: string, offeringId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const ctx = await loadOrgRangeContext(org.orgId, offeringId, fromDate, days);
  if (!ctx) return null;
  return { org, ...ctx };
}

export async function getRangeAvailability(
  input: unknown,
): Promise<
  { ok: true; availability: RangeAvailability; units: PublicUnit[] } | { ok: false; error: string }
> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = getRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, fromDate, days } = parsed.data;
  try {
    const ctx = await loadRangeContext(handle, offeringId, fromDate, days);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const availability = computeRangeAvailability({
      offering: ctx.offering,
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: ctx.org.timeZone,
      now: new Date(),
      fromDate,
      days,
    });
    return { ok: true, availability, units: ctx.units };
  } catch (error) {
    console.error("[rentals] getRangeAvailability:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

// The RPC raises 'taken' when no unit survives its own turnover/blackout
// check; the per-unit EXCLUDE guard (0037) raises 23P01 on a physical
// overlap that slipped past it.
function isTaken(error: { message?: string; code?: string }): boolean {
  return (error.message ?? "").includes("taken") || error.code === "23P01";
}

export async function createRentalBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; datesTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = createRentalBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, unitId, startDate, endDate, name, email, note } = parsed.data;

  try {
    const org = await getBookingOrg(handle);
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const offering = await getPublicOfferingById(org.orgId, offeringId);
    if (!offering) return { ok: false, error: GENERIC_WRITE_ERROR };
    // The span the stay occupies plus its turnover tail — capped at the
    // booking window, since validateStay rejects anything past it ("window")
    // before it ever consults the day map, and an unbounded endDate would
    // otherwise size the engine's loop.
    const span =
      Math.min(stayLength(offering.rangeMode, startDate, endDate), offering.bookingWindowDays) +
      offering.turnoverDays +
      2;
    const ctx = await loadOrgRangeContext(org.orgId, offeringId, startDate, span);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };

    // The RPC rejects a stay whose check-in has already passed (a booking that
    // starts in the past can never be cancelled). Say so here rather than let
    // the picker fail with the generic error; `datesTaken` makes the flow
    // reset and refetch, which is what the client needs to do anyway.
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime, org.timeZone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: CHECK_IN_PASSED, datesTaken: true };
    }

    // Re-run the engine over the requested stay; the RPC re-checks the same
    // rules under an advisory lock, this is the friendly-error pass.
    const availability = computeRangeAvailability({
      offering: ctx.offering,
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: org.timeZone,
      now: new Date(),
      fromDate: startDate,
      days: span,
    });
    const stay = validateStay(ctx.offering, availability, startDate, endDate);
    if (!stay.ok) {
      // order/min_stay/max_stay/window can only appear if the UI let a bad
      // range through — nothing the client can fix by picking again.
      return stay.reason === "unavailable"
        ? { ok: false, error: DATES_TAKEN, datesTaken: true }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return { ok: false, error: DATES_TAKEN, datesTaken: true };
    }

    const { token, tokenHash } = generateAccessToken();
    const anon = createAnonServerClient();
    const call = () =>
      anon.rpc("create_rental_booking", {
        p_handle: handle,
        p_offering_id: offeringId,
        p_unit_id: unitId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_name: name,
        p_email: email,
        p_note: note ?? null,
        p_token_hash: tokenHash,
      });

    let { data: bookingId, error } = await call();
    // Auto-assignment: a lost race means "some other unit may still be
    // free", so one retry re-picks. An explicit unit has nothing to re-pick.
    if (error && isTaken(error) && unitId === null) ({ data: bookingId, error } = await call());
    if (error) {
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      console.error("[rentals] createRentalBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Best-effort confirmation (the booking survives email failure).
    try {
      const tz = org.timeZone;
      const starts = wallTimeToUtc(startDate, ctx.offering.startTime, tz);
      const ends = wallTimeToUtc(endDate, ctx.offering.endTime, tz);
      const unitName = await getBookingUnitName(bookingId as string);
      const msg = bookingConfirmationEmail({
        orgName: org.orgName,
        serviceName: unitName ? `${ctx.offering.name} · ${unitName}` : ctx.offering.name,
        whenLine: formatRangeWhenLine(starts, ends, tz),
        manageUrl: buildBookingManageUrl(token),
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
      console.error("[rentals] confirmation email failed:", mailError);
    }

    return { ok: true, token };
  } catch (error) {
    console.error("[rentals] createRentalBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
