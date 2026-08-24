"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingUnitName,
  loadOrgRangeContext,
  type PublicOffering,
  type PublicUnit,
} from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  bookingRescheduledEmail,
  formatRangeWhenLine,
} from "@/features/scheduling/templates";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  ADMIN_WINDOW_DAYS,
  asEngineOffering,
  computeRangeAvailability,
  stayLength,
  validateStay,
  type RangeAvailability,
} from "./range";
import {
  adminRangeAvailabilityInput,
  createRentalAdminInput,
  rescheduleRentalAdminInput,
  CHECK_IN_PASSED,
  DATES_TAKEN,
  STAY_STARTED,
  GENERIC_WRITE_ERROR,
} from "./schema";

// An offering that is no longer active comes back as the same uniform 'not
// found' raise as everything else; say what actually went wrong.
const OFFERING_INACTIVE = "This offering is inactive — reactivate it to move its stays.";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[rentals] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// booking-actions.ts (scheduling) idiom: the session's single org. Every
// loader below is called with this id, which is what scopes the
// admin-client reads in @/lib/booking/public to the caller's own data.
// Null while the org's `rentals` flag is off (lib/flags): rentals are on by
// default since H1, and the flag is a kill switch, so every caller's null
// branch (the generic error) is the server-side defence while it's off
// (public-actions.ts idiom).
async function currentOrg(): Promise<{ id: string; name: string; timezone: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone").limit(1).maybeSingle();
  if (!data) return null;
  if (!(await getDashboardFlags(data.id)).rentals) return null;
  return data;
}

// `loadOrgRangeContext` resolves active offerings only, so a null context is
// ambiguous: wrong id, or an offering that has since been deactivated. One
// extra read separates them for the error copy.
async function offeringIsInactive(orgId: string, offeringId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rental_offerings")
    .select("active")
    .eq("id", offeringId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ? data.active === false : false;
}

// 'taken' is the RPC's own "no unit survives turnover/blackouts"; 23P01 is
// the per-unit EXCLUDE guard catching a physical overlap (public-actions).
function isTaken(error: { message?: string; code?: string }): boolean {
  return isRpcSentinel(error, "taken") || error.code === "23P01";
}
function isStarted(error: { message?: string }): boolean {
  return isRpcSentinel(error, "started");
}

export async function getAdminRangeAvailability(input: unknown): Promise<
  | { ok: true; availability: RangeAvailability; units: PublicUnit[]; offering: PublicOffering }
  | { ok: false; error: string }
> {
  const parsed = adminRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { offeringId, fromDate, days, excludeBookingId } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const ctx = await loadOrgRangeContext(org.id, offeringId, fromDate, days, {
      includeInactiveUnits: true,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: OFFERING_INACTIVE }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: org.timezone,
      now: new Date(),
      fromDate,
      days,
      // The provider is not bound by their own notice/window policy, and the
      // stay being moved must not block itself.
      ignoreLimits: true,
      excludeBookingId: excludeBookingId ?? undefined,
    });
    return { ok: true, availability, units: ctx.units, offering: ctx.offering };
  } catch (error) {
    return fail("getAdminRangeAvailability", error);
  }
}

// The span a stay occupies plus room for its turnover tail (max 30 days) and
// a day of slack on either edge — validateStay reads the day map that far.
// Bounded by the admin window: it rejects anything past it before reading the
// map at all, so an absurd endDate must not size the engine's loop.
function engineSpan(startDate: string, endDate: string): number {
  return Math.min(stayLength("days", startDate, endDate), ADMIN_WINDOW_DAYS) + 32;
}

export async function rescheduleRentalBookingAdmin(input: unknown): Promise<
  | { ok: true; unitChanged: boolean; datesChanged: boolean; emailed: boolean }
  | { ok: false; error: string; datesTaken?: boolean }
> {
  const parsed = rescheduleRentalAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, unitId, startDate, endDate } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, rental_offering_id, rental_unit_id, starts_at, client_email, rental_offerings(unit_selection)")
      .eq("id", id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("rescheduleRentalBookingAdmin", readError);
    const row = booking as unknown as {
      id: string;
      rental_offering_id: string | null;
      rental_unit_id: string | null;
      starts_at: string;
      client_email: string | null;
      rental_offerings: { unit_selection: "auto" | "client_picks" } | null;
    } | null;
    if (!row || row.rental_offering_id === null) {
      return { ok: false, error: "Only a confirmed stay can be moved." };
    }
    // Same rule as the RPC's 'started' raise, said before the round trip.
    if (new Date(row.starts_at).getTime() <= Date.now()) {
      return { ok: false, error: STAY_STARTED };
    }

    const span = engineSpan(startDate, endDate);
    const ctx = await loadOrgRangeContext(org.id, row.rental_offering_id, startDate, span, {
      includeInactiveUnits: true,
      excludeBookingId: row.id,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, row.rental_offering_id))
        ? { ok: false, error: OFFERING_INACTIVE }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // A same-day move past today's check-in time can never be cancelled, so
    // the RPC refuses it — say so rather than fail with the generic error.
    // This action is nights/days-only (loadOrgRangeContext's offering is
    // never an hours offering here) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timezone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: CHECK_IN_PASSED, datesTaken: true };
    }

    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: startDate,
      days: span,
      ignoreLimits: true,
      excludeBookingId: row.id,
    });
    const stay = validateStay(asEngineOffering(ctx.offering), availability, startDate, endDate);
    if (!stay.ok) {
      // order/min_stay/max_stay/window mean the dialog let a bad range
      // through — picking again won't help.
      return stay.reason === "unavailable"
        ? { ok: false, error: DATES_TAKEN, datesTaken: true }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return { ok: false, error: DATES_TAKEN, datesTaken: true };
    }

    const fresh = generateAccessToken();
    const { data, error } = await supabase.rpc("reschedule_rental_booking_admin", {
      p_booking_id: row.id,
      p_unit_id: unitId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (isStarted(error)) return { ok: false, error: STAY_STARTED };
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      return fail("rescheduleRentalBookingAdmin", error);
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
    if (!moved) return { ok: false, error: GENERIC_WRITE_ERROR };

    // Notification rules (R2 spec): the client hears about a date change; a
    // unit swap only matters to a client who chose the unit themselves; an
    // auto-assigned swap is an internal detail and stays silent. No provider
    // notice on this path — the provider IS the one who moved the stay
    // (rescheduleBookingAdmin, the appointment precedent, does the same).
    const clientPicks = row.rental_offerings?.unit_selection === "client_picks";
    const notifyClient =
      moved.client_email !== null && (moved.dates_changed || (moved.unit_changed && clientPicks));
    // The move already happened — never fail the action on a send.
    let emailed = false;
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
    if (notifyClient) {
      try {
        const msg = bookingRescheduledEmail({
          orgName: moved.org_name,
          serviceName: moved.service_name,
          oldWhenLine,
          whenLine,
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
        });
        await selectTransport().send({
          to: moved.client_email!,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "rescheduled"),
        });
        emailed = true;
      } catch (mailError) {
        console.error("[rentals] move client email failed:", mailError);
      }
    }

    revalidatePath("/bookings");
    return {
      ok: true,
      unitChanged: moved.unit_changed,
      datesChanged: moved.dates_changed,
      emailed,
    };
  } catch (error) {
    return fail("rescheduleRentalBookingAdmin", error);
  }
}

export async function createRentalBookingAdmin(
  input: unknown,
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string; datesTaken?: boolean }> {
  const parsed = createRentalAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { offeringId, unitId, startDate, endDate, name, email, note } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const span = engineSpan(startDate, endDate);
    const ctx = await loadOrgRangeContext(org.id, offeringId, startDate, span, {
      includeInactiveUnits: true,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: OFFERING_INACTIVE }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Nights/days-only action (as above) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timezone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: CHECK_IN_PASSED, datesTaken: true };
    }

    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: startDate,
      days: span,
      ignoreLimits: true,
    });
    const stay = validateStay(asEngineOffering(ctx.offering), availability, startDate, endDate);
    if (!stay.ok) {
      return stay.reason === "unavailable"
        ? { ok: false, error: DATES_TAKEN, datesTaken: true }
        : { ok: false, error: GENERIC_WRITE_ERROR };
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return { ok: false, error: DATES_TAKEN, datesTaken: true };
    }

    const supabase = await createClient();
    const { token, tokenHash } = generateAccessToken();
    const { data: bookingId, error } = await supabase.rpc("create_rental_booking_admin", {
      p_offering_id: offeringId,
      p_unit_id: unitId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_name: name,
      p_email: email ?? null,
      p_note: note ?? null,
      p_token_hash: tokenHash,
    });
    if (error) {
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      return fail("createRentalBookingAdmin", error);
    }

    let emailed = false;
    if (email) {
      try {
        const tz = org.timezone;
        // Nights/days-only action (as above) — endTime is set (0056 CHECK).
        const ends = wallTimeToUtc(endDate, ctx.offering.endTime!, tz);
        const unitName = await getBookingUnitName(bookingId as string);
        const msg = bookingConfirmationEmail({
          orgName: org.name,
          serviceName: unitName ? `${ctx.offering.name} · ${unitName}` : ctx.offering.name,
          whenLine: formatRangeWhenLine(startsAt, ends, tz),
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
        emailed = true;
      } catch (mailError) {
        console.error("[rentals] admin create email failed:", mailError);
      }
    }

    revalidatePath("/bookings");
    return { ok: true, emailed };
  } catch (error) {
    return fail("createRentalBookingAdmin", error);
  }
}
