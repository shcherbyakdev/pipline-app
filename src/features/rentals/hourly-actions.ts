"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter, publicSlotsLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { getBookingOrg, getBookingUnitName, loadOrgHourlyContext, type PublicUnit } from "@/lib/booking/public";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { getProviderEmail } from "@/lib/booking/provider";
import { selectTransport } from "@/lib/email/transport";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { env } from "@/env";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { addDaysISO, computeSlots, dateInZone } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  providerNewBookingEmail,
  formatHourlyWhenLine,
} from "@/features/scheduling/templates";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import {
  durationOptions,
  hourlySlotService,
  isHourlyOffering,
  unionUnitSlots,
  type HourlyOffering,
} from "./hourly";
import { moneyInfoLines, totalCents, depositCents } from "./pricing";
import {
  getHourlySlotsInput,
  createRentalBookingHoursInput,
  GENERIC_WRITE_ERROR,
  SLOT_TAKEN_HOURLY,
  TERMS_REQUIRED,
} from "./schema";

const TOO_MANY_REQUESTS = "Too many requests — slow down.";
const TOO_MANY_FOR_EMAIL =
  "Too many bookings for this email address in the last hour — try again later.";

// Two buckets (scheduling/public-actions.ts idiom): browsing weeks is cheap
// and frequent, a booking is an RPC plus emails.
async function limited(kind: "slots" | "booking"): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !(kind === "slots" ? publicSlotsLimiter : publicBookingLimiter).allow(key);
}

// Shared by both actions: org + everything the hourly engine needs.
async function loadHourlyContext(
  handle: string,
  offeringId: string,
  fromDate: string,
  days: number,
  opts?: { unitId?: string; excludeBookingId?: string },
) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  // Rentals are on by default since H1; the org's `rentals` flag is a kill
  // switch — this is the server-side defence while it's off.
  if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return null;
  // The org-mode gate (offers_rentals) decides what the org sells: a
  // channel it doesn't offer must not disclose availability either.
  if (!org.offersRentals) return null;
  const ctx = await loadOrgHourlyContext(org.orgId, offeringId, org.timeZone, fromDate, days, opts);
  if (!ctx) return null;
  // H5b: see capRangeUnits in public-actions.ts — hidden units never reach
  // the engine, the unit picker, or the RPC.
  const resources = await loadPublicResources(org.orgId);
  if (!resources) return { org, ...ctx, capped: false };
  const allowed = resources.allowedUnitIds;
  const perUnit = ctx.perUnit.filter((u) => allowed.has(u.unitId));
  return {
    org,
    ...ctx,
    units: ctx.units.filter((u) => allowed.has(u.id)),
    perUnit,
    capped: perUnit.length < ctx.perUnit.length,
  };
}

// The engine runs once per unit; the client sees the union (a time is
// offered if ANY unit can take it). Auto-assign happens in the RPC, which
// re-checks availability + turnover under the advisory lock.
function hourlySlotsFor(
  ctx: NonNullable<Awaited<ReturnType<typeof loadHourlyContext>>>,
  durationMin: number,
  fromDate: string,
  days: number,
) {
  const service = hourlySlotService(ctx.offering as HourlyOffering, durationMin);
  const now = new Date();
  return unionUnitSlots(
    ctx.perUnit.map((u) => ({
      unitId: u.unitId,
      slots: computeSlots({
        service,
        rules: ctx.rules,
        exceptions: ctx.exceptions,
        busy: u.busy,
        timeZone: ctx.org.timeZone,
        now,
        fromDate,
        days,
      }),
    })),
  );
}

export async function getHourlySlots(
  input: unknown,
): Promise<
  | {
      ok: true;
      slots: { startsAt: string; unitIds: string[] }[];
      // getRangeAvailability's `units` twin: the client_picks unit step
      // (HourlyBookingFlow) needs names/descriptions for the ids a slot's
      // `unitIds` carries, not just the ids themselves.
      units: PublicUnit[];
    }
  | { ok: false; error: string }
> {
  if (await limited("slots")) return { ok: false, error: TOO_MANY_REQUESTS };
  const parsed = getHourlySlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, durationMin, fromDate, days, unitId } = parsed.data;
  try {
    // getSlots idiom (scheduling/public-actions.ts): fromDate is viewer-local;
    // pad the engine window a day each side, the client keeps what lands on
    // its page.
    const from = addDaysISO(fromDate, -1);
    const span = days + 2;
    const ctx = await loadHourlyContext(handle, offeringId, from, span, { unitId: unitId ?? undefined });
    if (!ctx || !isHourlyOffering(ctx.offering)) return { ok: false, error: GENERIC_WRITE_ERROR };
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const slots = hourlySlotsFor(ctx, durationMin, from, span);
    return {
      ok: true,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), unitIds: s.unitIds })),
      units: ctx.units,
    };
  } catch (error) {
    console.error("[rentals] getHourlySlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

// The RPC raises 'taken' when no unit survives its own turnover/blackout
// check; the per-unit EXCLUDE guard (0056) raises 23P01 on a physical
// overlap that slipped past it (rentals/public-actions.ts's isTaken idiom).
function isTaken(error: { message?: string; code?: string }): boolean {
  return isRpcSentinel(error, "taken") || error.code === "23P01";
}

export async function createRentalBookingHours(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }> {
  if (await limited("booking")) return { ok: false, error: TOO_MANY_REQUESTS };
  const parsed = createRentalBookingHoursInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, unitId, startsAt, durationMin, name, email, note, termsAccepted } = parsed.data;

  try {
    const starts = new Date(startsAt);
    // createBooking idiom (scheduling/public-actions.ts): an approximate
    // (UTC-dated) window loads busy data wide enough to cover the true
    // org-local day regardless of viewer/org offset; the engine is re-run
    // below on the PRECISE org-local date using the same fetched data.
    // Deliberately NOT narrowed by unitId (unlike getHourlySlots above) —
    // a client_picks request's unitId is checked against every unit's own
    // slot membership below, not assumed correct.
    const ctx = await loadHourlyContext(handle, offeringId, dateInZone(starts, "UTC"), 2);
    if (!ctx || !isHourlyOffering(ctx.offering)) return { ok: false, error: GENERIC_WRITE_ERROR };
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    // H3: the RPC stamps terms_accepted_at on its own whenever the offering
    // carries terms_text — this is the actual enforcement in front of it
    // (rentals/public-actions.ts's createRentalBooking idiom).
    if (ctx.offering.termsText !== null && !termsAccepted) {
      return { ok: false, error: TERMS_REQUIRED };
    }

    // Re-run the engine for the org-local day of the requested instant; the
    // requested instant must be in the union of the eligible units' outputs,
    // and (client_picks) the chosen unit must be among the free ones. The
    // per-unit EXCLUDE constraint remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = hourlySlotsFor(ctx, durationMin, localDate, 2);
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match || (unitId !== null && !match.unitIds.includes(unitId))) {
      return { ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true };
    }

    const { token, tokenHash } = generateAccessToken();
    // 0056: create_rental_booking_hours is service_role-only — the hourly
    // engine's rules (opening hours, notice, window, grid) run here, not in
    // the RPC, so this action is the only entry.
    const admin = createAdminClient();
    const call = (pUnitId: string | null) =>
      admin.rpc("create_rental_booking_hours", {
        p_handle: handle,
        p_offering_id: offeringId,
        p_unit_id: pUnitId,
        p_starts_at: starts.toISOString(),
        p_duration_min: durationMin,
        p_name: name,
        p_email: email,
        p_note: note ?? null,
        p_token_hash: tokenHash,
      });

    // Same ladder as createRentalBooking (public-actions.ts): explicit unit
    // once; uncapped auto-assign = null + one retry; capped auto-assign names
    // the allowed free units (match.unitIds — the engine only ever saw those).
    const attempts: (string | null)[] =
      unitId !== null ? [unitId] : ctx.capped ? match.unitIds : [null, null];
    if (attempts.length === 0) return { ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true };
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      // Per-email hourly cap (0056).
      if (isRpcSentinel(error, "too_many")) return { ok: false, error: TOO_MANY_FOR_EMAIL };
      if (isTaken(error)) return { ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true };
      console.error("[rentals] createRentalBookingHours:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    const tz = ctx.org.timeZone;
    const ends = new Date(starts.getTime() + durationMin * 60_000);
    const whenLine = formatHourlyWhenLine(starts, ends, tz);
    const unitName = await getBookingUnitName(bookingId as string);
    const serviceName = unitName ? `${ctx.offering.name} · ${unitName}` : ctx.offering.name;
    // Best-effort like everything below: a null provider address only means
    // the provider gets no copy of this booking.
    const providerEmail = await getProviderEmail(ctx.org.orgId).catch((e) => {
      console.error("[rentals] getProviderEmail:", e);
      return null;
    });
    // H3: total / deposit / pay-at-venue / cancellation-policy lines, shared
    // by the client confirmation and the provider's copy below.
    const total = totalCents(ctx.offering, durationMin / 60);
    const infoLines = moneyInfoLines({
      totalCents: total,
      depositCents: depositCents(ctx.offering, total),
      currency: ctx.org.currency,
      cancelWindowMin: ctx.offering.cancelWindowMin,
    });

    // Best-effort confirmation (the booking survives email failure).
    try {
      const msg = bookingConfirmationEmail({
        orgName: ctx.org.orgName,
        serviceName,
        whenLine,
        manageUrl: buildBookingManageUrl(token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        // "Powered by Booklo" unless the org's plan lets it opt out and it
        // did (emailBadgeUrl swallows its own errors — same discipline as
        // scheduling/public-actions.ts's own confirmation send).
        badgeUrl: await emailBadgeUrl(ctx.org.orgId),
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

    // The provider's own copy — copied wholesale from createBooking
    // (scheduling/public-actions.ts), reply-to wiring included. Nights/days
    // rentals still lack this (deferred minor, noted in the PR description).
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
    console.error("[rentals] createRentalBookingHours:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
