"use server";

import { emailTranslators } from "@/i18n/emails";
import { stampBookingLocale } from "@/lib/booking/client-locale";
import { publicError, type OrgLocaleSource } from "@/i18n/public";
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
import { notifyMembers } from "@/features/notifications/notify";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { withUnit } from "@/features/rentals/unit-label";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  bookingRequestReceivedEmail,
  formatRangeWhenLine,
  formatUntil,
  paymentDueEmail,
} from "@/features/scheduling/templates";
import { formatMoney } from "@/lib/money";
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
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = getRangeAvailabilityInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
  const { handle, offeringId, fromDate, days } = parsed.data;
  try {
    const ctx = await loadRangeContext(handle, offeringId, fromDate, days);
    if (!ctx) return publicError(orgLocale, "generic");
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
    return publicError(orgLocale, "generic");
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
): Promise<
  | { ok: true; token: string; pending: boolean; payment?: { until: string; amount: string } }
  | { ok: false; error: string; datesTaken?: boolean }
> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited()) return publicError(orgLocale, "tooManyRequests");
  const parsed = createRentalBookingInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
  const { handle, offeringId, unitId, startDate, endDate, name, email, phone, note, termsAccepted } = parsed.data;

  try {
    const org = await getBookingOrg(handle);
    if (!org) return publicError(orgLocale, "generic");
    if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return publicError(orgLocale, "generic");
    const offering = await getPublicOfferingById(org.orgId, offeringId);
    if (!offering) return publicError(orgLocale, "generic");
    // H3: the RPC stamps terms_accepted_at on its own whenever the offering
    // carries terms_text — this is the actual enforcement in front of it.
    if (offering.termsText !== null && !termsAccepted) {
      return publicError(orgLocale, "termsRequired");
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
    if (!raw) return publicError(orgLocale, "generic");
    const ctx = await capRangeUnits(org.orgId, raw);

    // The RPC rejects a stay whose check-in has already passed (a booking that
    // starts in the past can never be cancelled). Say so here rather than let
    // the picker fail with the generic error; `datesTaken` makes the flow
    // reset and refetch, which is what the client needs to do anyway.
    // The public range-booking flow is nights/days-only (createRentalBooking
    // never resolves an hours offering) — startTime is set (0056 CHECK).
    const startsAt = wallTimeToUtc(startDate, ctx.offering.startTime!, org.timeZone);
    if (startsAt.getTime() <= Date.now()) {
      return publicError(orgLocale, "checkInPassed", { datesTaken: true });
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
        ? publicError(orgLocale, "datesTaken", { datesTaken: true })
        : publicError(orgLocale, "generic");
    }
    if (unitId !== null && !stay.unitIds.includes(unitId)) {
      return publicError(orgLocale, "datesTaken", { datesTaken: true });
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
        // Either may be null; the RPC requires whichever orgs.client_contact
        // names (0086).
        p_email: email ?? null,
        p_phone: phone ?? null,
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
    if (attempts.length === 0) return publicError(orgLocale, "datesTaken", { datesTaken: true });
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      if (isTaken(error)) return publicError(orgLocale, "datesTaken", { datesTaken: true });
      console.error("[rentals] createRentalBooking:", error.code || "rpc error");
      return publicError(orgLocale, "generic");
    }

    // The RPC decided under the flag it read at insert time — one select
    // keeps the emails honest even if the toggle flips mid-flight. Read it
    // here, before mail prep, so every success return below can carry it.
    const { data: statusRow, error: statusError } = await admin
      .from("bookings").select("status, hold_expires_at, deposit_cents").eq("id", bookingId as string).maybeSingle();
    if (statusError) console.error("[rentals] createRentalBooking status read:", statusError);
    const isPending = statusRow?.status === "pending";
    // S2: the RPC held the row for its deposit (0079) — the client gets the
    // "pay by" mail instead of a confirmation, and the provider hears
    // nothing until the payment lands (the webhook's newBooking).
    const isHeld = statusRow?.status === "pending_payment";
    const holdUntil = isHeld && statusRow?.hold_expires_at ? new Date(statusRow.hold_expires_at) : null;
    kickCalendarSync(org.orgId); // Google mirror (spec 2026-09-05 §2.2)

    // Everything both mails share, computed once; nothing below may fail the
    // committed booking, so the unit-name/provider-email reads swallow their
    // own errors AND the whole block is wrapped below — a throw here (e.g.
    // formatRangeWhenLine, totalCents) must not report a committed booking
    // as failed to the caller.
    // Two languages (spec §4, amended 2026-09-03): the client reads the one
    // they booked in, the provider reads the org's. Hence the doubled
    // when-line and money lines below — both are locale-formatted.
    const client = await emailTranslators(await stampBookingLocale(admin, bookingId as string, org.locale));
    const mail = await emailTranslators(org.locale);
    let prep: {
      whenLine: string;
      clientWhenLine: string;
      serviceName: string;
      infoLines: string[];
      clientInfoLines: string[];
    } | null = null;
    // S2: the hold's deadline and deposit, in the client's language — what
    // the widget's pay panel and the "pay by" mail both print. Set inside the
    // prep block below (same locale reads), so an early return carries it too.
    let payment: { until: string; amount: string } | undefined;
    try {
      const tz = org.timeZone;
      // Nights/days-only flow (as above) — both are set (0056 CHECK).
      const starts = wallTimeToUtc(startDate, ctx.offering.startTime!, tz);
      const ends = wallTimeToUtc(endDate, ctx.offering.endTime!, tz);
      const whenLine = formatRangeWhenLine(starts, ends, tz, mail.intlLocale);
      const clientWhenLine = formatRangeWhenLine(starts, ends, tz, client.intlLocale);
      const unitName = await getBookingUnitName(bookingId as string).catch((e) => {
        console.error("[rentals] getBookingUnitName:", e);
        return null;
      });
      const serviceName = withUnit(ctx.offering.name, unitName);
      const total = totalCents(
        ctx.offering,
        stayUnits(ctx.offering.rangeMode as "nights" | "days", startDate, endDate),
      );
      const money = {
        totalCents: total,
        depositCents: depositCents(ctx.offering, total),
        currency: org.currency,
        cancelPolicy: ctx.offering.cancelPolicy,
        holding: isHeld,
      };
      const infoLines = moneyInfoLines(money, mail.tUnits);
      const clientInfoLines = moneyInfoLines(money, client.tUnits);
      if (holdUntil && statusRow?.deposit_cents != null) {
        payment = {
          until: formatUntil(holdUntil, tz, client.intlLocale),
          amount: formatMoney(statusRow.deposit_cents, org.currency),
        };
      }
      prep = { whenLine, clientWhenLine, serviceName, infoLines, clientInfoLines };
    } catch (error) {
      console.error("[rentals] post-booking mail prep failed:", error);
      return { ok: true, token, pending: isPending, payment };
    }
    const { whenLine, clientWhenLine, serviceName, infoLines, clientInfoLines } = prep;

    // Best-effort confirmation (the booking survives email failure). Pending:
    // the request-received twin instead — nothing is confirmed yet.
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = payment
        ? paymentDueEmail(client.t, {
            orgName: org.orgName,
            serviceName,
            whenLine: clientWhenLine,
            until: payment.until,
            amount: payment.amount,
            payUrl: `${manageUrl}/pay`,
            manageUrl,
            infoLines: clientInfoLines,
          })
        : isPending
          ? bookingRequestReceivedEmail(client.t, {
              orgName: org.orgName,
              serviceName,
              whenLine: clientWhenLine,
              manageUrl,
              infoLines: clientInfoLines,
            })
          : bookingConfirmationEmail(client.t, {
              orgName: org.orgName,
              serviceName,
              whenLine: clientWhenLine,
              manageUrl,
              icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
              infoLines: clientInfoLines,
            });
      // No address (a phone-only org, 0086): the confirmed panel is the
      // client's only copy — it carries the pay and manage links itself.
      if (email) await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: payment
          ? bookingLifecycleKey(bookingId as string, "payment-due")
          : bookingIdempotencyKey(bookingId as string),
      });
    } catch (mailError) {
      console.error("[rentals] confirmation email failed:", mailError);
    }

    // The org's own people — the nights/days twin of the notice
    // createRentalBookingHours sends (H5b closes the gap H3 and H5a noted).
    // One seam, each member's channels (/notifications); it swallows its own
    // errors, so a failed client mail can't skip it.
    // A hold is not a booking yet: the webhook sends this notice when the
    // money lands, so the provider is told once, about a real booking.
    if (!isHeld) {
      await notifyMembers({
        orgId: org.orgId,
        event: isPending ? "newRequest" : "newBooking",
        serviceName,
        clientName: name,
        clientEmail: email ?? null,
        clientPhone: phone ?? null,
        whenLine,
        note: note ?? null,
        infoLines,
        idempotencyKey: bookingLifecycleKey(bookingId as string, "provider-new"),
      });
    }

    return { ok: true, token, pending: isPending, payment };
  } catch (error) {
    console.error("[rentals] createRentalBooking:", error);
    return publicError(orgLocale, "generic");
  }
}
