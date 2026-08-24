"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl, resolveBookingToken } from "@/lib/tokens/booking";
import {
  getBookingOfferingId,
  getPublicOfferingById,
  loadOrgRangeContext,
  type PublicOffering,
  type PublicUnit,
} from "@/lib/booking/public";
import { getProviderEmail } from "@/lib/booking/provider";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingLifecycleKey,
  bookingRescheduledEmail,
  formatRangeWhenLine,
  providerRescheduledEmail,
} from "@/features/scheduling/templates";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  asEngineOffering,
  computeRangeAvailability,
  stayLength,
  validateStay,
  type RangeAvailability,
} from "./range";
import {
  manageRangeAvailabilityInput,
  rescheduleRentalInput,
  CHECK_IN_PASSED,
  DATES_TAKEN,
  STAY_STARTED,
  GENERIC_WRITE_ERROR,
} from "./schema";

// The rental half of scheduling/manage-actions.ts: token-authenticated,
// anon-client, best-effort emails. Cancellation is already shared (0037's
// cancel_booking speaks for stays too) — only the reschedule path needs a
// range engine instead of a slot grid.

const NOT_CHANGEABLE = "This booking can no longer be changed online.";
const TOO_MANY = "Too many requests — slow down.";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Same guard as the appointment path plus the rental discriminator: only a
// confirmed, still-future STAY is actionable here (mirrors the RPC).
async function resolveActionable(token: string) {
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok") return null;
  const { booking } = result;
  if (booking.status !== "confirmed") return null;
  if (booking.startsAt.getTime() <= Date.now()) return null;
  const { rentalUnitId } = booking;
  if (rentalUnitId === null) return null;
  // Re-stated so the unit id stays non-null past this boundary.
  return { ...booking, rentalUnitId };
}

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[rentals] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// 'taken' is the RPC's own "no unit survives turnover/blackouts"; 23P01 is
// the per-unit EXCLUDE guard catching a physical overlap (public-actions).
function isTaken(error: { message?: string; code?: string }): boolean {
  return isRpcSentinel(error, "taken") || error.code === "23P01";
}
function isStarted(error: { message?: string }): boolean {
  return isRpcSentinel(error, "started");
}

export async function getManageRangeAvailability(input: unknown): Promise<
  | {
      ok: true;
      availability: RangeAvailability;
      units: PublicUnit[];
      offering: PublicOffering;
      currentUnitId: string;
      // The stay's own check-in date, org-local: the panel opens on that
      // month rather than on today's.
      startDate: string;
    }
  | { ok: false; error: string }
> {
  if (await limited()) return { ok: false, error: TOO_MANY };
  const parsed = manageRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { token, fromDate, days } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };
    // Rentals are on by default since H1; the org's `rentals` flag is a kill
    // switch — this is the server-side defence while it's off
    // (public-actions.ts idiom).
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return { ok: false, error: GENERIC_WRITE_ERROR };
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return { ok: false, error: NOT_CHANGEABLE };
    const ctx = await loadOrgRangeContext(booking.orgId, offeringId, fromDate, days, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };
    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate,
      days,
      // The client IS bound by notice/window (no ignoreLimits — the RPC
      // enforces both on this path); the stay being moved must not block
      // itself.
      excludeBookingId: booking.id,
    });
    return {
      ok: true,
      availability,
      units: ctx.units,
      offering: ctx.offering,
      currentUnitId: booking.rentalUnitId,
      startDate: dateInZone(booking.startsAt, booking.orgTimezone),
    };
  } catch (error) {
    return fail("getManageRangeAvailability", error);
  }
}

export async function rescheduleRentalBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; datesTaken?: boolean }> {
  if (await limited()) return { ok: false, error: TOO_MANY };
  const parsed = rescheduleRentalInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { token, unitId, startDate, endDate } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };
    // Same flag gate as getManageRangeAvailability: the move is a write.
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return { ok: false, error: GENERIC_WRITE_ERROR };
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return { ok: false, error: NOT_CHANGEABLE };
    const offering = await getPublicOfferingById(booking.orgId, offeringId);
    if (!offering) return { ok: false, error: NOT_CHANGEABLE };

    // createRentalBooking's span idiom: the stay plus its turnover tail,
    // capped at the booking window (validateStay rejects anything past it as
    // "window" before reading the day map, so an absurd endDate must not
    // size the engine's loop).
    const span =
      Math.min(stayLength(asEngineOffering(offering).rangeMode, startDate, endDate), offering.bookingWindowDays) +
      offering.turnoverDays +
      2;
    const ctx = await loadOrgRangeContext(booking.orgId, offeringId, startDate, span, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };

    // Which unit serves the stay is the provider's business unless the
    // offering lets the client pick, so drop any unit the payload names on an
    // `auto` offering (rental-booking-flow.tsx does the same on the create
    // path) — the RPC then auto-assigns as it would for a fresh booking.
    const pickedUnitId = ctx.offering.unitSelection === "client_picks" ? unitId : null;

    // A move onto today past the check-in time can never be cancelled, so
    // the RPC refuses it; `datesTaken` makes the panel reset and refetch,
    // which is what the client has to do anyway.
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime, booking.orgTimezone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: CHECK_IN_PASSED, datesTaken: true };
    }

    // Engine re-check (createRentalBooking idiom): the friendly-error pass
    // ahead of the RPC, which re-checks the same rules under its lock.
    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate: startDate,
      days: span,
      excludeBookingId: booking.id,
    });
    const stay = validateStay(asEngineOffering(ctx.offering), availability, startDate, endDate);
    if (!stay.ok) {
      // order/min_stay/max_stay/window mean the panel let a bad range
      // through — picking again won't help.
      return stay.reason === "unavailable"
        ? { ok: false, error: DATES_TAKEN, datesTaken: true }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }
    if (pickedUnitId !== null && !stay.unitIds.includes(pickedUnitId)) {
      return { ok: false, error: DATES_TAKEN, datesTaken: true };
    }

    const fresh = generateAccessToken();
    // 0052: the RPC left the anon surface (service_role only) — the token is
    // still the credential, this action's engine pre-check is the only entry.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reschedule_rental_booking", {
      p_token: token,
      p_unit_id: pickedUnitId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (isStarted(error)) return { ok: false, error: STAY_STARTED };
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      console.error("[rentals] rescheduleRentalBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const moved = (data as Array<{
      new_booking_id: string;
      org_id: string;
      org_name: string;
      org_timezone: string;
      service_name: string;
      client_name: string;
      client_email: string | null;
      old_starts_at: string;
      old_ends_at: string;
      new_starts_at: string;
      new_ends_at: string;
      unit_changed: boolean;
      dates_changed: boolean;
    }> | null)?.[0];
    // A token miss comes back as no rows (resolver doctrine), never a raise.
    if (!moved) return { ok: false, error: NOT_CHANGEABLE };

    // Best-effort notifications — the move is already committed. The client
    // always gets one when they have an address on file, even if nothing
    // moved: the old link is dead, and this email carries the new one.
    try {
      const tz = moved.org_timezone;
      const oldWhenLine = formatRangeWhenLine(
        new Date(moved.old_starts_at),
        new Date(moved.old_ends_at),
        tz,
      );
      const whenLine = formatRangeWhenLine(
        new Date(moved.new_starts_at),
        new Date(moved.new_ends_at),
        tz,
      );
      if (moved.client_email) {
        const msg = bookingRescheduledEmail({
          orgName: moved.org_name,
          serviceName: moved.service_name,
          oldWhenLine,
          whenLine,
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        });
        await selectTransport().send({
          to: moved.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "rescheduled"),
        });
      }
      // The provider only hears about a real move: a no-op re-confirm (same
      // dates, same unit) reissues the client's link and nothing else.
      const providerEmail = moved.dates_changed ? await getProviderEmail(moved.org_id) : null;
      if (providerEmail) {
        const notice = providerRescheduledEmail({
          serviceName: moved.service_name,
          oldWhenLine,
          whenLine,
          clientName: moved.client_name,
        });
        await selectTransport().send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "provider-rescheduled"),
        });
      }
    } catch (mailError) {
      console.error("[rentals] reschedule emails failed:", mailError);
    }

    return { ok: true, token: fresh.token };
  } catch (error) {
    return fail("rescheduleRentalBooking", error);
  }
}
