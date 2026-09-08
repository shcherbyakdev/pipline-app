"use server";

import { emailTranslators } from "@/i18n/emails";
import { publicLocale } from "@/i18n/public";
import { publicError, type OrgLocaleSource } from "@/i18n/public";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl, resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingLocale, getOrgLocale } from "@/lib/booking/public";
import {
  getBookingMoney,
  getBookingOfferingId,
  getPublicOfferingById,
  loadOrgHourlyContext,
  loadOrgRangeContext,
  type PublicOffering,
  type PublicUnit,
} from "@/lib/booking/public";
import { notifyMembers } from "@/features/notifications/notify";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { refundBooking } from "@/features/payments/refund";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { addDaysISO, computeSlots, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingLifecycleKey,
  bookingRescheduledEmail,
  formatHourlyWhenLine,
  formatRangeWhenLine,
} from "@/features/scheduling/templates";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  asEngineOffering,
  computeRangeAvailability,
  stayLength,
  validateStay,
  type RangeAvailability,
} from "./range";
import { hourlySlotService, isHourlyOffering, unionUnitSlots } from "./hourly";
import { moneyInfoLines } from "./pricing";
import type { CancelPolicy } from "./cancel-policy";
import type { ExtraPick, Line } from "./pricing-rules";
import {
  manageRangeAvailabilityInput,
  manageHourlySlotsInput,
  rescheduleRentalInput,
  rescheduleRentalHoursInput,
} from "./schema";

// The rental half of scheduling/manage-actions.ts: token-authenticated,
// anon-client, best-effort emails. Cancellation is already shared (0037's
// cancel_booking speaks for stays too) — only the reschedule path needs a
// range engine instead of a slot grid.


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

function fail(context: string, error: unknown, orgLocale: OrgLocaleSource) {
  console.error(`[rentals] ${context}:`, error);
  return publicError(orgLocale, "generic");
}

// 'taken' is the RPC's own "no unit survives turnover/blackouts"; 23P01 is
// the per-unit EXCLUDE guard catching a physical overlap (public-actions).
function isTaken(error: { message?: string; code?: string }): boolean {
  return isRpcSentinel(error, "taken") || error.code === "23P01";
}
function isStarted(error: { message?: string }): boolean {
  return isRpcSentinel(error, "started");
}

// S3: what the reschedule preview needs on both availability responses —
// the row's own money/policy (resolveBookingToken already read them) plus
// the picks the re-quote uses, so a panel can price the candidate
// client-side the way the widget does.
type ManageBookingMoney = {
  startsAt: string;
  priceCents: number | null;
  currency: string | null;
  paidCents: number;
  refundedCents: number;
  feeCents: number;
  cancelPolicy: CancelPolicy | null;
  people: number | null;
  extras: ExtraPick[];
};

function toManageBookingMoney(booking: {
  startsAt: Date;
  priceCents: number | null;
  currency: string | null;
  paidCents: number;
  refundedCents: number;
  feeCents: number;
  cancelPolicy: CancelPolicy | null;
  people: number | null;
  lines: Line[] | null;
}): ManageBookingMoney {
  return {
    startsAt: booking.startsAt.toISOString(),
    priceCents: booking.priceCents,
    currency: booking.currency,
    paidCents: booking.paidCents,
    refundedCents: booking.refundedCents,
    feeCents: booking.feeCents,
    cancelPolicy: booking.cancelPolicy,
    people: booking.people,
    extras: (booking.lines ?? []).flatMap((l) => (l.kind === "extra" ? [{ id: l.extraId, qty: l.qty }] : [])),
  };
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
      booking: ManageBookingMoney;
    }
  | { ok: false; error: string }
> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = manageRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  const { token, fromDate, days } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return publicError(orgLocale, "notChangeable");
    orgLocale = () => getOrgLocale(booking.orgId);
    // Rentals are on by default since H1; the org's `rentals` flag is a kill
    // switch — this is the server-side defence while it's off
    // (public-actions.ts idiom).
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return publicError(orgLocale, "generic");
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return publicError(orgLocale, "notChangeable");
    const ctx = await loadOrgRangeContext(booking.orgId, offeringId, fromDate, days, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return publicError(orgLocale, "notChangeable");
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
      // S3: what the reschedule preview needs — the row's own money and
      // policy (resolveBookingToken already read them) plus the picks the
      // re-quote uses, so the panel can price the candidate client-side the
      // way the widget does.
      booking: toManageBookingMoney(booking),
    };
  } catch (error) {
    return fail("getManageRangeAvailability", error, orgLocale);
  }
}

export async function rescheduleRentalBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; datesTaken?: boolean }> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = rescheduleRentalInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  const { token, unitId, startDate, endDate } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return publicError(orgLocale, "notChangeable");
    orgLocale = () => getOrgLocale(booking.orgId);
    // Same flag gate as getManageRangeAvailability: the move is a write.
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return publicError(orgLocale, "generic");
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return publicError(orgLocale, "notChangeable");
    const offering = await getPublicOfferingById(booking.orgId, offeringId);
    if (!offering) return publicError(orgLocale, "notChangeable");

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
    if (!ctx) return publicError(orgLocale, "notChangeable");

    // Which unit serves the stay is the provider's business unless the
    // offering lets the client pick, so drop any unit the payload names on an
    // `auto` offering (rental-booking-flow.tsx does the same on the create
    // path) — the RPC then auto-assigns as it would for a fresh booking.
    const pickedUnitId = ctx.offering.unitSelection === "client_picks" ? unitId : null;

    // A move onto today past the check-in time can never be cancelled, so
    // the RPC refuses it; `datesTaken` makes the panel reset and refetch,
    // which is what the client has to do anyway.
    // The tokenized manage flow is nights/days-only (loadOrgRangeContext's
    // offering here is never hours) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, booking.orgTimezone);
    if (startsAt.getTime() <= Date.now()) {
      return publicError(orgLocale, "checkInPassed", { datesTaken: true });
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
        ? publicError(orgLocale, "datesTaken", { datesTaken: true })
        : publicError(orgLocale, "generic");
    }
    if (pickedUnitId !== null && !stay.unitIds.includes(pickedUnitId)) {
      return publicError(orgLocale, "datesTaken", { datesTaken: true });
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
      if (isStarted(error)) return publicError(orgLocale, "stayStarted");
      if (isTaken(error)) return publicError(orgLocale, "datesTaken", { datesTaken: true });
      console.error("[rentals] rescheduleRentalBooking:", error.code || "rpc error");
      return publicError(orgLocale, "generic");
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
    if (!moved) return publicError(orgLocale, "notChangeable");
    kickCalendarSync(moved.org_id); // Google mirror (spec 2026-09-05 §2.2)

    // S3: the new row carries paid money and (maybe) a late-change fee; what
    // the studio now holds above the new total plus fee goes back. Read the
    // committed row (never recompute), refund the excess, and let the mail
    // below print the same numbers. Best effort — the move is committed.
    const money = await getBookingMoney(moved.new_booking_id);
    const excess = money.totalCents === null
      ? 0
      : Math.max(0, money.paidCents - money.refundedCents - (money.totalCents + money.feeCents));
    const refund = excess > 0
      ? await refundBooking(moved.new_booking_id, "reschedule", {}, { amountCents: excess }).catch((e) => {
          console.error("[payments] reschedule refund:", e);
          return { refundedCents: 0, failed: true };
        })
      : { refundedCents: 0, failed: false };
    const moneyAfter = { ...money, refundedCents: money.refundedCents + refund.refundedCents };

    // Best-effort notifications — the move is already committed. The client
    // always gets one when they have an address on file, even if nothing
    // moved: the old link is dead, and this email carries the new one.
    try {
      // Two languages (spec §4, amended 2026-09-03): the provider's notice
      // below stays the org's, the client's mail follows the booking — or the
      // ?lang= they are looking at right now. The new row inherits the locale
      // in the DB (bookings_locale_carry, 0072).
      const orgLang = await getOrgLocale(booking.orgId);
      const mail = await emailTranslators(orgLang);
      const client = await emailTranslators(
        await publicLocale((await getBookingLocale(booking.id)) ?? orgLang),
      );
      const tz = moved.org_timezone;
      const oldFor = (intlLocale: string) =>
        formatRangeWhenLine(new Date(moved.old_starts_at), new Date(moved.old_ends_at), tz, intlLocale);
      const newFor = (intlLocale: string) =>
        formatRangeWhenLine(new Date(moved.new_starts_at), new Date(moved.new_ends_at), tz, intlLocale);
      const oldWhenLine = oldFor(mail.intlLocale);
      const whenLine = newFor(mail.intlLocale);
      const clientOldWhenLine = oldFor(client.intlLocale);
      const clientWhenLine = newFor(client.intlLocale);
      if (moved.client_email) {
        const msg = bookingRescheduledEmail(client.t, {
          orgName: moved.org_name,
          serviceName: moved.service_name,
          oldWhenLine: clientOldWhenLine,
          whenLine: clientWhenLine,
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
          infoLines: moneyInfoLines(moneyAfter, client.tUnits),
        });
        await selectTransport().send({
          to: moved.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "rescheduled"),
        });
      }
      // The org's people only hear about a real move: a no-op re-confirm (same
      // dates, same unit) reissues the client's link and nothing else.
      if (moved.dates_changed) {
        await notifyMembers({
          orgId: moved.org_id,
          event: "rescheduled",
          serviceName: moved.service_name,
          clientName: moved.client_name,
          clientEmail: moved.client_email,
          whenLine,
          oldWhenLine,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "provider-rescheduled"),
        });
      }
    } catch (mailError) {
      console.error("[rentals] reschedule emails failed:", mailError);
    }

    return { ok: true, token: fresh.token };
  } catch (error) {
    return fail("rescheduleRentalBooking", error, orgLocale);
  }
}

// ---------- Hourly (H2) analogs. Duration-based occupancy instead of a
// date range — the same token/limiter/flag doctrine as the pair above, with
// the range engine swapped for the hourly slot engine (hourly-actions.ts's
// loadHourlyContext/hourlySlotsFor idiom, duplicated here rather than
// imported: that helper is keyed by `handle`, this surface by `token`).

export async function getManageHourlySlots(input: unknown): Promise<
  | {
      ok: true;
      slots: { startsAt: string; unitIds: string[] }[];
      // Same-duration ruling: the booking's own span, never renegotiated.
      durationMin: number;
      // getManageRangeAvailability's own twin fields: the client_picks unit
      // step (R2's UnitSelect) needs the offering (unitSelection) and unit
      // names, not just the ids a slot's `unitIds` carries.
      offering: PublicOffering;
      units: PublicUnit[];
      currentUnitId: string;
      booking: ManageBookingMoney;
    }
  | { ok: false; error: string }
> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = manageHourlySlotsInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  const { token, fromDate, days } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return publicError(orgLocale, "notChangeable");
    orgLocale = () => getOrgLocale(booking.orgId);
    // Same flag gate as getManageRangeAvailability: rentals is a kill switch.
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return publicError(orgLocale, "generic");
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return publicError(orgLocale, "notChangeable");

    // Duration comes ONLY from the existing row — never from client input.
    // A reschedule may move the booking, not stretch or shrink it (mirrors
    // 0056's reschedule_rental_hours_apply, which copies it server-side too).
    const durationMin = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);

    // getHourlySlots idiom (hourly-actions.ts): fromDate is viewer-local; pad
    // the engine window a day each side, the client keeps what lands on its
    // page.
    const from = addDaysISO(fromDate, -1);
    const span = days + 2;
    const ctx = await loadOrgHourlyContext(booking.orgId, offeringId, booking.orgTimezone, from, span, {
      excludeBookingId: booking.id,
    });
    if (!ctx || !isHourlyOffering(ctx.offering)) return publicError(orgLocale, "notChangeable");

    const service = hourlySlotService(ctx.offering, durationMin);
    const now = new Date();
    const slots = unionUnitSlots(
      ctx.perUnit.map((u) => ({
        unitId: u.unitId,
        slots: computeSlots({
          service,
          rules: ctx.rules,
          exceptions: ctx.exceptions,
          busy: u.busy,
          timeZone: booking.orgTimezone,
          now,
          fromDate: from,
          days: span,
        }),
      })),
    );
    return {
      ok: true,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), unitIds: s.unitIds })),
      durationMin,
      offering: ctx.offering,
      units: ctx.units,
      currentUnitId: booking.rentalUnitId,
      // S3: same as getManageRangeAvailability — the preview's inputs.
      booking: toManageBookingMoney(booking),
    };
  } catch (error) {
    return fail("getManageHourlySlots", error, orgLocale);
  }
}

export async function rescheduleRentalBookingHours(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; datesTaken?: boolean }> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = rescheduleRentalHoursInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  const { token, unitId, startsAt } = parsed.data;
  try {
    const booking = await resolveActionable(token);
    if (!booking) return publicError(orgLocale, "notChangeable");
    orgLocale = () => getOrgLocale(booking.orgId);
    // Same flag gate as getManageHourlySlots: the move is a write.
    if (!(await getOrgFlagsAdmin(booking.orgId)).rentals) return publicError(orgLocale, "generic");
    const offeringId = await getBookingOfferingId(booking.id);
    if (offeringId === null) return publicError(orgLocale, "notChangeable");

    // Same-duration ruling, computed here (not taken from the client) so the
    // engine pre-check below and the RPC (which copies it server-side from
    // the old row) can never disagree with what was actually offered.
    const durationMin = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
    const starts = new Date(startsAt);
    const localDate = dateInZone(starts, booking.orgTimezone);

    // createRentalBookingHours idiom: a narrow 2-day window centred on the
    // requested instant is enough for the exact-epoch re-check below.
    const ctx = await loadOrgHourlyContext(booking.orgId, offeringId, booking.orgTimezone, localDate, 2, {
      excludeBookingId: booking.id,
    });
    if (!ctx || !isHourlyOffering(ctx.offering)) return publicError(orgLocale, "notChangeable");

    // Which unit serves the booking is the provider's business unless the
    // offering lets the client pick, so drop any unit the payload names on
    // an `auto` offering (rescheduleRentalBooking idiom) — the RPC then
    // keeps the current unit if it's still free, else the first free one.
    const pickedUnitId = ctx.offering.unitSelection === "client_picks" ? unitId : null;

    // Engine re-check (createRentalBookingHours idiom): the friendly-error
    // pass ahead of the RPC, which re-checks the same rules under its lock.
    // Exact epoch match — a stale slot (someone else took it, or it fell out
    // of the offering's hours) simply won't be in this fresh union.
    const service = hourlySlotService(ctx.offering, durationMin);
    const slots = unionUnitSlots(
      ctx.perUnit.map((u) => ({
        unitId: u.unitId,
        slots: computeSlots({
          service,
          rules: ctx.rules,
          exceptions: ctx.exceptions,
          busy: u.busy,
          timeZone: booking.orgTimezone,
          now: new Date(),
          fromDate: localDate,
          days: 2,
        }),
      })),
    );
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match || (pickedUnitId !== null && !match.unitIds.includes(pickedUnitId))) {
      return publicError(orgLocale, "slotTaken", { datesTaken: true });
    }

    const fresh = generateAccessToken();
    // 0052/0056 posture: the RPC left the anon surface (service_role only) —
    // the token is still the credential, this action's engine pre-check is
    // the only entry.
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token,
      p_unit_id: pickedUnitId,
      p_starts_at: starts.toISOString(),
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (isStarted(error)) return publicError(orgLocale, "stayStarted");
      if (isTaken(error)) return publicError(orgLocale, "slotTaken", { datesTaken: true });
      console.error("[rentals] rescheduleRentalBookingHours:", error.code || "rpc error");
      return publicError(orgLocale, "generic");
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
    if (!moved) return publicError(orgLocale, "notChangeable");
    kickCalendarSync(moved.org_id); // Google mirror (spec 2026-09-05 §2.2)

    // S3: the new row carries paid money and (maybe) a late-change fee; what
    // the studio now holds above the new total plus fee goes back. Read the
    // committed row (never recompute), refund the excess, and let the mail
    // below print the same numbers. Best effort — the move is committed.
    const money = await getBookingMoney(moved.new_booking_id);
    const excess = money.totalCents === null
      ? 0
      : Math.max(0, money.paidCents - money.refundedCents - (money.totalCents + money.feeCents));
    const refund = excess > 0
      ? await refundBooking(moved.new_booking_id, "reschedule", {}, { amountCents: excess }).catch((e) => {
          console.error("[payments] reschedule refund:", e);
          return { refundedCents: 0, failed: true };
        })
      : { refundedCents: 0, failed: false };
    const moneyAfter = { ...money, refundedCents: money.refundedCents + refund.refundedCents };

    // Best-effort notifications, copied wholesale from rescheduleRentalBooking
    // (provider notice IS sent on client reschedules — R2's admin-only-silence
    // ruling does not apply here) — only formatRangeWhenLine swapped for
    // formatHourlyWhenLine. The move is already committed; the client always
    // gets one when they have an address on file, even if nothing moved: the
    // old link is dead, and this email carries the new one.
    try {
      // Two languages (spec §4, amended 2026-09-03): the provider's notice
      // below stays the org's, the client's mail follows the booking — or the
      // ?lang= they are looking at right now. The new row inherits the locale
      // in the DB (bookings_locale_carry, 0072).
      const orgLang = await getOrgLocale(booking.orgId);
      const mail = await emailTranslators(orgLang);
      const client = await emailTranslators(
        await publicLocale((await getBookingLocale(booking.id)) ?? orgLang),
      );
      const tz = moved.org_timezone;
      const oldFor = (intlLocale: string) =>
        formatHourlyWhenLine(new Date(moved.old_starts_at), new Date(moved.old_ends_at), tz, intlLocale);
      const newFor = (intlLocale: string) =>
        formatHourlyWhenLine(new Date(moved.new_starts_at), new Date(moved.new_ends_at), tz, intlLocale);
      const oldWhenLine = oldFor(mail.intlLocale);
      const whenLine = newFor(mail.intlLocale);
      const clientOldWhenLine = oldFor(client.intlLocale);
      const clientWhenLine = newFor(client.intlLocale);
      if (moved.client_email) {
        // S1: the move re-quotes at the new time (a night surcharge is
        // earned by the hours actually booked, and a menu edit can have
        // degraded the picks), so the mail prints the NEW row's own
        // snapshot — read from the committed booking, never recomputed.
        // S3: `moneyAfter` folds in this reschedule's own settlement refund.
        const clientInfoLines = moneyInfoLines(moneyAfter, client.tUnits);
        const msg = bookingRescheduledEmail(client.t, {
          orgName: moved.org_name,
          serviceName: moved.service_name,
          oldWhenLine: clientOldWhenLine,
          whenLine: clientWhenLine,
          manageUrl: buildBookingManageUrl(fresh.token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
          infoLines: clientInfoLines,
        });
        await selectTransport().send({
          to: moved.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "rescheduled"),
        });
      }
      // The org's people only hear about a real move: a no-op re-confirm (same
      // time, same unit) reissues the client's link and nothing else.
      if (moved.dates_changed) {
        await notifyMembers({
          orgId: moved.org_id,
          event: "rescheduled",
          serviceName: moved.service_name,
          clientName: moved.client_name,
          clientEmail: moved.client_email,
          whenLine,
          oldWhenLine,
          idempotencyKey: bookingLifecycleKey(moved.new_booking_id, "provider-rescheduled"),
        });
      }
    } catch (mailError) {
      console.error("[rentals] hourly reschedule emails failed:", mailError);
    }

    return { ok: true, token: fresh.token };
  } catch (error) {
    return fail("rescheduleRentalBookingHours", error, orgLocale);
  }
}
