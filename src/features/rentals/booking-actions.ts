"use server";

import { emailTranslators } from "@/i18n/emails";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingMoney,
  getBookingUnitName,
  listBookingEquipmentUnitIds,
  loadOrgRangeContext,
  loadOrgHourlyContext,
  type PublicOffering,
  type PublicUnit,
} from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { withUnit } from "@/features/rentals/unit-label";
import { wallTimeToUtc, dateInZone, computeSlots } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  bookingRescheduledEmail,
  formatRangeWhenLine,
  formatHourlyWhenLine,
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
  durationOptions,
  hourlySlotService,
  isHourlyOffering,
  unionUnitSlots,
  type HourlyOffering,
} from "./hourly";
import { moneyInfoLines } from "./pricing";
import {
  adminRangeAvailabilityInput,
  createRentalAdminInput,
  rescheduleRentalAdminInput,
  adminHourlySlotsInput,
  createRentalHoursAdminInput,
  rescheduleRentalHoursAdminInput,
} from "./schema";
import { getTranslations } from "next-intl/server";
import { stampBookingPhone } from "@/lib/booking/client-phone";
import { kickCalendarSync } from "@/features/calendar-sync/run";

// Admin posture (Task 10, the R2 ignoreLimits equivalent): the provider is
// not bound by their own offering's notice/booking-window policy — occupancy
// (busy) still applies via the fetched context, only these two engine knobs
// are overridden. 366, not Infinity: bookingWindowDays feeds a plain date
// arithmetic add (slots.ts), which an infinite value would blow up.
function adminHourlyService(offering: HourlyOffering, durationMin: number) {
  return { ...hourlySlotService(offering, durationMin), minNoticeMin: 0, bookingWindowDays: 366 };
}

// Every refusal is an `errors.*` key resolved in the admin's language (i18n
// Wave 3): each action takes `t` up front; fail() resolves its own generic.
// A space that is no longer active comes back as the same uniform 'not
// found' raise as everything else — `bookings.spaceInactive` says what
// actually went wrong.
async function fail(context: string, error: unknown): Promise<{ ok: false; error: string }> {
  console.error(`[rentals] ${context}:`, error);
  return { ok: false, error: (await getTranslations("errors"))("generic") };
}

// booking-actions.ts (scheduling) idiom: the session's single org. Every
// loader below is called with this id, which is what scopes the
// admin-client reads in @/lib/booking/public to the caller's own data.
// Null while the org's `rentals` flag is off (lib/flags): rentals are on by
// default since H1, and the flag is a kill switch, so every caller's null
// branch (the generic error) is the server-side defence while it's off
// (public-actions.ts idiom).
async function currentOrg(): Promise<{ id: string; name: string; timezone: string; locale: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone, locale").limit(1).maybeSingle();
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
// 23P01 = the EXCLUDE lost the race; 40P01 = two compound bookings deadlocked
// on it (S6: one booking now touches several units). Both mean "just taken".
function isTaken(error: { message?: string; code?: string }): boolean {
  return isRpcSentinel(error, "taken") || error.code === "23P01" || error.code === "40P01";
}
function isStarted(error: { message?: string }): boolean {
  return isRpcSentinel(error, "started");
}

export async function getAdminRangeAvailability(input: unknown): Promise<
  | { ok: true; availability: RangeAvailability; units: PublicUnit[]; offering: PublicOffering }
  | { ok: false; error: string }
> {
  const t = await getTranslations("errors");
  const parsed = adminRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { offeringId, fromDate, days, excludeBookingId } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const ctx = await loadOrgRangeContext(org.id, offeringId, fromDate, days, {
      includeInactiveUnits: true,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
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
  | { ok: true; id: string; unitChanged: boolean; datesChanged: boolean; emailed: boolean }
  | { ok: false; error: string; datesTaken?: boolean }
> {
  const t = await getTranslations("errors");
  const parsed = rescheduleRentalAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { id, unitId, startDate, endDate } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, rental_offering_id, rental_unit_id, starts_at, client_email, locale, rental_offerings(unit_selection)")
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
      locale: string | null;
      rental_offerings: { unit_selection: "auto" | "client_picks" } | null;
    } | null;
    if (!row || row.rental_offering_id === null) {
      return { ok: false, error: t("bookings.stayNotMovable") };
    }
    // Same rule as the RPC's 'started' raise, said before the round trip.
    if (new Date(row.starts_at).getTime() <= Date.now()) {
      return { ok: false, error: t("stayStarted") };
    }

    const span = engineSpan(startDate, endDate);
    const ctx = await loadOrgRangeContext(org.id, row.rental_offering_id, startDate, span, {
      includeInactiveUnits: true,
      excludeBookingId: row.id,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, row.rental_offering_id))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
    }

    // A same-day move past today's check-in time can never be cancelled, so
    // the RPC refuses it — say so rather than fail with the generic error.
    // This action is nights/days-only (loadOrgRangeContext's offering is
    // never an hours offering here) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timezone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: t("checkInPassed"), datesTaken: true };
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
        ? { ok: false, error: t("datesTaken"), datesTaken: true }
        : { ok: false, error: t("generic") };
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return { ok: false, error: t("datesTaken"), datesTaken: true };
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
      if (isStarted(error)) return { ok: false, error: t("stayStarted") };
      if (isTaken(error)) return { ok: false, error: t("datesTaken"), datesTaken: true };
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
    if (!moved) return { ok: false, error: t("generic") };
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

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
    // Client-only mail on this path, so one language: the one they booked
    // in (0072). The moved row inherited it (bookings_locale_carry).
    const mail = await emailTranslators(row.locale ?? org.locale);
    const tz = moved.org_timezone;
    const oldWhenLine = formatRangeWhenLine(
      new Date(moved.old_starts_at),
      new Date(moved.old_ends_at),
      tz,
      mail.intlLocale,
    );
    const whenLine = formatRangeWhenLine(
      new Date(moved.new_starts_at),
      new Date(moved.new_ends_at),
      tz,
      mail.intlLocale,
    );
    if (notifyClient) {
      try {
        const msg = bookingRescheduledEmail(mail.t, {
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
      // The move is a NEW row (the old one is 'rescheduled'); a caller that
      // wants to move it again — the timeline's Undo — needs this id.
      id: moved.new_booking_id,
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
  const t = await getTranslations("errors");
  const parsed = createRentalAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { offeringId, unitId, startDate, endDate, name, email, note } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const span = engineSpan(startDate, endDate);
    const ctx = await loadOrgRangeContext(org.id, offeringId, startDate, span, {
      includeInactiveUnits: true,
    });
    if (!ctx) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
    }

    // Nights/days-only action (as above) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timezone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: t("checkInPassed"), datesTaken: true };
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
        ? { ok: false, error: t("datesTaken"), datesTaken: true }
        : { ok: false, error: t("generic") };
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return { ok: false, error: t("datesTaken"), datesTaken: true };
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
      if (isTaken(error)) return { ok: false, error: t("datesTaken"), datesTaken: true };
      return fail("createRentalBookingAdmin", error);
    }
    await stampBookingPhone(bookingId as string, org.id, parsed.data.phone);
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    let emailed = false;
    if (email) {
      try {
        const tz = org.timezone;
        // Nights/days-only action (as above) — endTime is set (0056 CHECK).
        const ends = wallTimeToUtc(endDate, ctx.offering.endTime!, tz);
        const unitName = await getBookingUnitName(bookingId as string);
        const mail = await emailTranslators(org.locale);
        const msg = bookingConfirmationEmail(mail.t, {
          orgName: org.name,
          serviceName: withUnit(ctx.offering.name, unitName),
          whenLine: formatRangeWhenLine(startsAt, ends, tz, mail.intlLocale),
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

// ---------- Hourly mode (H2), admin (Task 10). Duration-based occupancy
// instead of a date range — same trio shape as the range actions above,
// with the range engine swapped for the hourly slot engine and the admin
// posture (minNotice/window ignored) applied via adminHourlyService.

export async function getAdminHourlySlots(input: unknown): Promise<
  | { ok: true; slots: { startsAt: string; unitIds: string[] }[]; units: PublicUnit[] }
  | { ok: false; error: string }
> {
  const t = await getTranslations("errors");
  const parsed = adminHourlySlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { offeringId, durationMin, fromDate, days, unitId, excludeBookingId } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const ctx = await loadOrgHourlyContext(org.id, offeringId, org.timezone, fromDate, days, {
      unitId: unitId ?? undefined,
      excludeBookingId: excludeBookingId ?? undefined,
      includeInactiveUnits: true,
      // S6: the equipment the booking being moved carries follows it, so the
      // times its own lamps are busy elsewhere are not free for this move.
      alsoBusyUnitIds: excludeBookingId ? await listBookingEquipmentUnitIds(excludeBookingId) : undefined,
    });
    if (!ctx || !isHourlyOffering(ctx.offering)) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
    }
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return { ok: false, error: t("generic") };
    }
    const service = adminHourlyService(ctx.offering, durationMin);
    const now = new Date();
    const slots = unionUnitSlots(
      ctx.perUnit.map((u) => ({
        unitId: u.unitId,
        slots: computeSlots({
          service,
          rules: ctx.rules,
          exceptions: ctx.exceptions,
          busy: u.busy,
          timeZone: org.timezone,
          now,
          fromDate,
          days,
        }),
      })),
    );
    return {
      ok: true,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), unitIds: s.unitIds })),
      units: ctx.units,
    };
  } catch (error) {
    return fail("getAdminHourlySlots", error);
  }
}

export async function createRentalBookingHoursAdmin(
  input: unknown,
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string; slotTaken?: boolean }> {
  const t = await getTranslations("errors");
  const parsed = createRentalHoursAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { offeringId, unitId, startsAt, durationMin, name, email, note } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const starts = new Date(startsAt);
    const localDate = dateInZone(starts, org.timezone);
    const ctx = await loadOrgHourlyContext(org.id, offeringId, org.timezone, localDate, 2, {
      includeInactiveUnits: true,
    });
    if (!ctx || !isHourlyOffering(ctx.offering)) {
      return (await offeringIsInactive(org.id, offeringId))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
    }
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return { ok: false, error: t("generic") };
    }

    // Engine re-check (createRentalBookingAdmin idiom): the friendly-error
    // pass ahead of the RPC, which re-checks occupancy under its own lock.
    // Exact epoch match — a stale slot (someone else took it, or it fell
    // outside the offering's hours since the page loaded) simply won't be
    // in this fresh union.
    const service = adminHourlyService(ctx.offering, durationMin);
    const slots = unionUnitSlots(
      ctx.perUnit.map((u) => ({
        unitId: u.unitId,
        slots: computeSlots({
          service,
          rules: ctx.rules,
          exceptions: ctx.exceptions,
          busy: u.busy,
          timeZone: org.timezone,
          now: new Date(),
          fromDate: localDate,
          days: 2,
        }),
      })),
    );
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match || (unitId !== null && !match.unitIds.includes(unitId))) {
      return { ok: false, error: t("slotTaken"), slotTaken: true };
    }

    const supabase = await createClient();
    const { token, tokenHash } = generateAccessToken();
    const { data: bookingId, error } = await supabase.rpc("create_rental_booking_hours_admin", {
      p_offering_id: offeringId,
      p_unit_id: unitId,
      p_starts_at: starts.toISOString(),
      p_duration_min: durationMin,
      p_name: name,
      p_email: email ?? null,
      p_note: note ?? null,
      p_token_hash: tokenHash,
    });
    if (error) {
      if (isTaken(error)) return { ok: false, error: t("slotTaken"), slotTaken: true };
      return fail("createRentalBookingHoursAdmin", error);
    }
    await stampBookingPhone(bookingId as string, org.id, parsed.data.phone);
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    let emailed = false;
    if (email) {
      try {
        const tz = org.timezone;
        const ends = new Date(starts.getTime() + durationMin * 60_000);
        const unitName = await getBookingUnitName(bookingId as string);
        const mail = await emailTranslators(org.locale);
        const msg = bookingConfirmationEmail(mail.t, {
          orgName: org.name,
          serviceName: withUnit(ctx.offering.name, unitName),
          whenLine: formatHourlyWhenLine(starts, ends, tz, mail.intlLocale),
          manageUrl: buildBookingManageUrl(token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
          // S1: the RPC quoted this walk-in and snapshotted the lines on the
          // row — the mail prints that snapshot, not a recomputation.
          infoLines: moneyInfoLines(
            await getBookingMoney(bookingId as string),
            mail.tUnits,
          ),
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
        console.error("[rentals] admin hourly create email failed:", mailError);
      }
    }

    revalidatePath("/bookings");
    return { ok: true, emailed };
  } catch (error) {
    return fail("createRentalBookingHoursAdmin", error);
  }
}

export async function rescheduleRentalHoursAdmin(input: unknown): Promise<
  | { ok: true; id: string; unitChanged: boolean; datesChanged: boolean; emailed: boolean }
  | { ok: false; error: string; datesTaken?: boolean }
> {
  const t = await getTranslations("errors");
  const parsed = rescheduleRentalHoursAdminInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("generic") };
  const { id, unitId, startsAt } = parsed.data;
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: t("generic") };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select(
        "id, rental_offering_id, rental_unit_id, starts_at, ends_at, client_email, locale, rental_offerings(unit_selection)",
      )
      .eq("id", id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("rescheduleRentalHoursAdmin", readError);
    const row = booking as unknown as {
      id: string;
      rental_offering_id: string | null;
      rental_unit_id: string | null;
      starts_at: string;
      ends_at: string;
      client_email: string | null;
      locale: string | null;
      rental_offerings: { unit_selection: "auto" | "client_picks" } | null;
    } | null;
    if (!row || row.rental_offering_id === null) {
      return { ok: false, error: t("bookings.notMovable") };
    }
    // Same rule as the RPC's own 'started' raise, said before the round trip.
    if (new Date(row.starts_at).getTime() <= Date.now()) {
      return { ok: false, error: t("bookings.alreadyStarted") };
    }

    // Same-duration ruling: the new booking's span is the OLD booking's
    // span, computed here (server-side) and never taken from the client —
    // the RPC copies it from the row the same way (0056's
    // reschedule_rental_hours_apply).
    const durationMin = Math.round(
      (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000,
    );
    const starts = new Date(startsAt);
    const localDate = dateInZone(starts, org.timezone);
    const ctx = await loadOrgHourlyContext(org.id, row.rental_offering_id, org.timezone, localDate, 2, {
      includeInactiveUnits: true,
      excludeBookingId: row.id,
    });
    if (!ctx || !isHourlyOffering(ctx.offering)) {
      return (await offeringIsInactive(org.id, row.rental_offering_id))
        ? { ok: false, error: t("bookings.spaceInactive") }
        : { ok: false, error: t("generic") };
    }

    const service = adminHourlyService(ctx.offering, durationMin);
    const slots = unionUnitSlots(
      ctx.perUnit.map((u) => ({
        unitId: u.unitId,
        slots: computeSlots({
          service,
          rules: ctx.rules,
          exceptions: ctx.exceptions,
          busy: u.busy,
          timeZone: org.timezone,
          now: new Date(),
          fromDate: localDate,
          days: 2,
        }),
      })),
    );
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match || (unitId !== null && !match.unitIds.includes(unitId))) {
      return { ok: false, error: t("slotTaken"), datesTaken: true };
    }

    const fresh = generateAccessToken();
    const { data, error } = await supabase.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: row.id,
      p_unit_id: unitId,
      p_starts_at: starts.toISOString(),
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (isStarted(error)) return { ok: false, error: t("bookings.alreadyStarted") };
      if (isTaken(error)) return { ok: false, error: t("slotTaken"), datesTaken: true };
      return fail("rescheduleRentalHoursAdmin", error);
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
    if (!moved) return { ok: false, error: t("generic") };
    kickCalendarSync(org.id); // Google mirror (spec 2026-09-05 §2.2)

    // Same notification rules as rescheduleRentalBookingAdmin (R2 spec): the
    // client hears about a time change; a unit swap only matters to a
    // client who chose the unit themselves; an auto-assigned swap stays
    // silent. No provider notice on this path — the provider IS the one who
    // moved the booking.
    const clientPicks = row.rental_offerings?.unit_selection === "client_picks";
    const notifyClient =
      moved.client_email !== null && (moved.dates_changed || (moved.unit_changed && clientPicks));
    // The move already happened — never fail the action on a send.
    let emailed = false;
    // Client-only mail on this path, so one language: the one they booked
    // in (0072). The moved row inherited it (bookings_locale_carry).
    const mail = await emailTranslators(row.locale ?? org.locale);
    const tz = moved.org_timezone;
    const oldWhenLine = formatHourlyWhenLine(
      new Date(moved.old_starts_at),
      new Date(moved.old_ends_at),
      tz,
      mail.intlLocale,
    );
    const whenLine = formatHourlyWhenLine(new Date(moved.new_starts_at), new Date(moved.new_ends_at), tz, mail.intlLocale);
    if (notifyClient) {
      try {
        const msg = bookingRescheduledEmail(mail.t, {
          orgName: moved.org_name,
          serviceName: moved.service_name,
          oldWhenLine,
          whenLine,
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
          // S1: the move was re-quoted at the new time — print the NEW row's
          // snapshot so the client sees what changed.
          infoLines: moneyInfoLines(
            await getBookingMoney(moved.new_booking_id),
            mail.tUnits,
          ),
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
        console.error("[rentals] admin hourly move client email failed:", mailError);
      }
    }

    revalidatePath("/bookings");
    return {
      ok: true,
      // The move is a NEW row (the old one is 'rescheduled'); a caller that
      // wants to move it again — the timeline's Undo — needs this id.
      id: moved.new_booking_id,
      unitChanged: moved.unit_changed,
      datesChanged: moved.dates_changed,
      emailed,
    };
  } catch (error) {
    return fail("rescheduleRentalHoursAdmin", error);
  }
}
