"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
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
import { loadPublicResources } from "@/lib/booking/public-offering";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { getProviderEmail } from "@/lib/booking/provider";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  formatRangeWhenLine,
  providerNewBookingEmail,
} from "@/features/scheduling/templates";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  asEngineOffering,
  computeRangeAvailability,
  stayLength,
  validateStay,
  type RangeAvailability,
} from "./range";
import { moneyInfoLines, totalCents, depositCents, stayUnits } from "./pricing";
import {
  getRangeAvailabilityInput,
  createRentalBookingInput,
  CHECK_IN_PASSED,
  DATES_TAKEN,
  GENERIC_WRITE_ERROR,
  TERMS_REQUIRED,
} from "./schema";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

type RangeCtx = NonNullable<Awaited<ReturnType<typeof loadOrgRangeContext>>>;

// H5b: narrow the engine's units to what the plan lets the public page book
// (null = no cap — billing off, byte-identical to before). `capped` says this
// space has at least one hidden unit, which is when a public create must name
// the unit itself rather than let the RPC auto-pick from every active unit.
async function capRangeUnits(orgId: string, ctx: RangeCtx): Promise<RangeCtx & { capped: boolean }> {
  const resources = await loadPublicResources(orgId);
  if (!resources) return { ...ctx, capped: false };
  const allowed = resources.allowedUnitIds;
  const rangeUnits = ctx.rangeUnits.filter((u) => allowed.has(u.id));
  return {
    ...ctx,
    units: ctx.units.filter((u) => allowed.has(u.id)),
    rangeUnits,
    capped: rangeUnits.length < ctx.rangeUnits.length,
  };
}

// Shared by both actions: org + everything the range engine needs.
async function loadRangeContext(handle: string, offeringId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  // Rentals are on by default since H1; the org's `rentals` flag is a kill
  // switch — this is the server-side defence while it's off.
  if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return null;
  // The org-mode gate (offers_rentals) decides what the org sells: a
  // channel it doesn't offer must not disclose availability either.
  if (!org.offersRentals) return null;
  const ctx = await loadOrgRangeContext(org.orgId, offeringId, fromDate, days);
  if (!ctx) return null;
  return { org, ...(await capRangeUnits(org.orgId, ctx)) };
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
      offering: asEngineOffering(ctx.offering),
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
  return isRpcSentinel(error, "taken") || error.code === "23P01";
}

export async function createRentalBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; datesTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = createRentalBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, unitId, startDate, endDate, name, email, note, termsAccepted } = parsed.data;

  try {
    const org = await getBookingOrg(handle);
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return { ok: false, error: GENERIC_WRITE_ERROR };
    const offering = await getPublicOfferingById(org.orgId, offeringId);
    if (!offering) return { ok: false, error: GENERIC_WRITE_ERROR };
    // H3: the RPC stamps terms_accepted_at on its own whenever the offering
    // carries terms_text — this is the actual enforcement in front of it.
    if (offering.termsText !== null && !termsAccepted) {
      return { ok: false, error: TERMS_REQUIRED };
    }
    // The span the stay occupies plus its turnover tail — capped at the
    // booking window, since validateStay rejects anything past it ("window")
    // before it ever consults the day map, and an unbounded endDate would
    // otherwise size the engine's loop.
    const span =
      Math.min(stayLength(asEngineOffering(offering).rangeMode, startDate, endDate), offering.bookingWindowDays) +
      offering.turnoverDays +
      2;
    const raw = await loadOrgRangeContext(org.orgId, offeringId, startDate, span);
    if (!raw) return { ok: false, error: GENERIC_WRITE_ERROR };
    const ctx = await capRangeUnits(org.orgId, raw);

    // The RPC rejects a stay whose check-in has already passed (a booking that
    // starts in the past can never be cancelled). Say so here rather than let
    // the picker fail with the generic error; `datesTaken` makes the flow
    // reset and refetch, which is what the client needs to do anyway.
    // The public range-booking flow is nights/days-only (createRentalBooking
    // never resolves an hours offering) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timeZone);
    if (startsAt.getTime() <= Date.now()) {
      return { ok: false, error: CHECK_IN_PASSED, datesTaken: true };
    }

    // Re-run the engine over the requested stay; the RPC re-checks the same
    // rules under an advisory lock, this is the friendly-error pass.
    const availability = computeRangeAvailability({
      offering: asEngineOffering(ctx.offering),
      units: ctx.rangeUnits,
      blackouts: ctx.blackouts,
      bookings: ctx.bookings,
      timeZone: org.timeZone,
      now: new Date(),
      fromDate: startDate,
      days: span,
    });
    const stay = validateStay(asEngineOffering(ctx.offering), availability, startDate, endDate);
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
    // 0052: create_rental_booking left the anon grant surface — the range
    // engine's rules (min stay, turnover, notice) run here, not in the RPC, so
    // this action is the only entry. service_role calls it; the token stays
    // the credential.
    const admin = createAdminClient();
    const call = (pUnitId: string | null) =>
      admin.rpc("create_rental_booking", {
        p_handle: handle,
        p_offering_id: offeringId,
        p_unit_id: pUnitId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_name: name,
        p_email: email,
        p_note: note ?? null,
        p_token_hash: tokenHash,
      });

    // What to hand the RPC, in order:
    //   a client-picked unit          → that unit, once;
    //   auto-assign, no cap           → null twice: the DB picks the first free
    //                                   active unit, one retry on a lost race
    //                                   ("some other unit may still be free");
    //   auto-assign, plan hides units → H5b: the DB must not pick a hidden
    //                                   unit, so name the engine's allowed free
    //                                   units one after another until one
    //                                   sticks (stay.unitIds is already the
    //                                   allowed free set — the engine only
    //                                   ever saw allowed units).
    const attempts: (string | null)[] =
      unitId !== null ? [unitId] : ctx.capped ? stay.unitIds : [null, null];
    if (attempts.length === 0) return { ok: false, error: DATES_TAKEN, datesTaken: true };
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      console.error("[rentals] createRentalBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Everything both mails share, computed once; nothing below may fail the
    // committed booking, so the unit-name/provider-email reads swallow their
    // own errors AND the whole block is wrapped below — a throw here (e.g.
    // formatRangeWhenLine, totalCents) must not report a committed booking
    // as failed to the caller.
    let prep: {
      whenLine: string;
      serviceName: string;
      infoLines: string[];
      providerEmail: string | null;
    } | null = null;
    try {
      const tz = org.timeZone;
      // Nights/days-only flow (as above) — both are set (0056 CHECK).
      const starts = wallTimeToUtc(startDate, ctx.offering.startTime!, tz);
      const ends = wallTimeToUtc(endDate, ctx.offering.endTime!, tz);
      const whenLine = formatRangeWhenLine(starts, ends, tz);
      const unitName = await getBookingUnitName(bookingId as string).catch((e) => {
        console.error("[rentals] getBookingUnitName:", e);
        return null;
      });
      const serviceName = unitName ? `${ctx.offering.name} · ${unitName}` : ctx.offering.name;
      const total = totalCents(
        ctx.offering,
        stayUnits(ctx.offering.rangeMode as "nights" | "days", startDate, endDate),
      );
      const infoLines = moneyInfoLines({
        totalCents: total,
        depositCents: depositCents(ctx.offering, total),
        currency: org.currency,
        cancelWindowMin: ctx.offering.cancelWindowMin,
      });
      const providerEmail = await getProviderEmail(org.orgId).catch((e) => {
        console.error("[rentals] getProviderEmail:", e);
        return null;
      });
      prep = { whenLine, serviceName, infoLines, providerEmail };
    } catch (error) {
      console.error("[rentals] post-booking mail prep failed:", error);
      return { ok: true, token };
    }
    const { whenLine, serviceName, infoLines, providerEmail } = prep;

    // Best-effort confirmation (the booking survives email failure).
    try {
      const msg = bookingConfirmationEmail({
        orgName: org.orgName,
        serviceName,
        whenLine,
        manageUrl: buildBookingManageUrl(token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        infoLines,
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

    // The provider's own copy — the nights/days twin of the notice
    // createRentalBookingHours sends (H5b closes the gap H3 and H5a noted).
    // Its own try so a failed client mail can't skip it.
    if (providerEmail) {
      try {
        const notice = providerNewBookingEmail({
          serviceName,
          clientName: name,
          clientEmail: email,
          whenLine,
          note: note ?? null,
          infoLines,
        });
        await selectTransport().send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          replyTo: email,
          idempotencyKey: bookingLifecycleKey(bookingId as string, "provider-new"),
        });
      } catch (mailError) {
        console.error("[rentals] provider notice failed:", mailError);
      }
    }

    return { ok: true, token };
  } catch (error) {
    console.error("[rentals] createRentalBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
