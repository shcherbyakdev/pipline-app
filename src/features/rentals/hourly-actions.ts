"use server";

import { emailTranslators } from "@/i18n/emails";
import { stampBookingLocale } from "@/lib/booking/client-locale";
import { publicError, type OrgLocaleSource } from "@/i18n/public";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter, publicSlotsLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { getBookingOrg, getBookingUnitName, loadOrgHourlyContext, type PublicUnit } from "@/lib/booking/public";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { notifyMembers } from "@/features/notifications/notify";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { withUnit } from "@/features/rentals/unit-label";
import { selectTransport } from "@/lib/email/transport";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { env } from "@/env";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { addDaysISO, computeSlots, dateInZone } from "@/features/scheduling/slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  bookingRequestReceivedEmail,
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
} from "./schema";


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
  opts?: { unitId?: string; excludeBookingId?: string; freshExternal?: boolean },
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
  let orgLocale: OrgLocaleSource = null;
  if (await limited("slots")) return publicError(orgLocale, "tooManyRequests");
  const parsed = getHourlySlotsInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
  const { handle, offeringId, durationMin, fromDate, days, unitId } = parsed.data;
  try {
    // getSlots idiom (scheduling/public-actions.ts): fromDate is viewer-local;
    // pad the engine window a day each side, the client keeps what lands on
    // its page.
    const from = addDaysISO(fromDate, -1);
    const span = days + 2;
    const ctx = await loadHourlyContext(handle, offeringId, from, span, { unitId: unitId ?? undefined });
    if (!ctx || !isHourlyOffering(ctx.offering)) return publicError(orgLocale, "generic");
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return publicError(orgLocale, "generic");
    }
    const slots = hourlySlotsFor(ctx, durationMin, from, span);
    return {
      ok: true,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), unitIds: s.unitIds })),
      units: ctx.units,
    };
  } catch (error) {
    console.error("[rentals] getHourlySlots:", error);
    return publicError(orgLocale, "generic");
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
): Promise<
  { ok: true; token: string; pending: boolean } | { ok: false; error: string; slotTaken?: boolean }
> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited("booking")) return publicError(orgLocale, "tooManyRequests");
  const parsed = createRentalBookingHoursInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
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
    // freshExternal: the slot being taken is checked against Google now,
    // not the minute-old memo (spec 2026-09-05 §2.6).
    const ctx = await loadHourlyContext(handle, offeringId, dateInZone(starts, "UTC"), 2, { freshExternal: true });
    if (!ctx || !isHourlyOffering(ctx.offering)) return publicError(orgLocale, "generic");
    if (!durationOptions(ctx.offering).includes(durationMin)) {
      return publicError(orgLocale, "generic");
    }
    // H3: the RPC stamps terms_accepted_at on its own whenever the offering
    // carries terms_text — this is the actual enforcement in front of it
    // (rentals/public-actions.ts's createRentalBooking idiom).
    if (ctx.offering.termsText !== null && !termsAccepted) {
      return publicError(orgLocale, "termsRequired");
    }

    // Re-run the engine for the org-local day of the requested instant; the
    // requested instant must be in the union of the eligible units' outputs,
    // and (client_picks) the chosen unit must be among the free ones. The
    // per-unit EXCLUDE constraint remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = hourlySlotsFor(ctx, durationMin, localDate, 2);
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match || (unitId !== null && !match.unitIds.includes(unitId))) {
      return publicError(orgLocale, "slotTaken", { slotTaken: true });
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
    if (attempts.length === 0) return publicError(orgLocale, "slotTaken", { slotTaken: true });
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      // Per-email hourly cap (0056).
      if (isRpcSentinel(error, "too_many")) return publicError(orgLocale, "tooManyForEmail");
      if (isTaken(error)) return publicError(orgLocale, "slotTaken", { slotTaken: true });
      console.error("[rentals] createRentalBookingHours:", error.code || "rpc error");
      return publicError(orgLocale, "generic");
    }

    // The RPC decided under the flag it read at insert time — one select
    // keeps the emails honest even if the toggle flips mid-flight. Read it
    // here, before mail prep, so every success return below can carry it.
    const { data: statusRow, error: statusError } = await admin
      .from("bookings").select("status").eq("id", bookingId as string).maybeSingle();
    if (statusError) console.error("[rentals] createRentalBookingHours status read:", statusError);
    const isPending = statusRow?.status === "pending";
    kickCalendarSync(ctx.org.orgId); // Google mirror (spec 2026-09-05 §2.2)

    // Everything both mails share, computed once; nothing below may fail the
    // committed booking, so the unit-name/provider-email reads swallow their
    // own errors AND the whole block is wrapped below — a throw here (e.g.
    // formatHourlyWhenLine, totalCents) must not report a committed booking
    // as failed to the caller.
    // Two languages (spec §4, amended 2026-09-03): the client reads the one
    // they booked in, the provider reads the org's — so the when-line and the
    // money lines, both locale-formatted, are built twice.
    const client = await emailTranslators(await stampBookingLocale(admin, bookingId as string, ctx.org.locale));
    const mail = await emailTranslators(ctx.org.locale);
    let prep: {
      whenLine: string;
      clientWhenLine: string;
      serviceName: string;
      infoLines: string[];
      clientInfoLines: string[];
    } | null = null;
    try {
      const tz = ctx.org.timeZone;
      const ends = new Date(starts.getTime() + durationMin * 60_000);
      const whenLine = formatHourlyWhenLine(starts, ends, tz, mail.intlLocale);
      const clientWhenLine = formatHourlyWhenLine(starts, ends, tz, client.intlLocale);
      const unitName = await getBookingUnitName(bookingId as string).catch((e) => {
        console.error("[rentals] getBookingUnitName:", e);
        return null;
      });
      const serviceName = withUnit(ctx.offering.name, unitName);
      // H3: total / deposit / pay-at-venue / cancellation-policy lines, shared
      // by the client confirmation and the provider's copy below.
      const total = totalCents(ctx.offering, durationMin / 60);
      const money = {
        totalCents: total,
        depositCents: depositCents(ctx.offering, total),
        currency: ctx.org.currency,
        cancelWindowMin: ctx.offering.cancelWindowMin,
      };
      const infoLines = moneyInfoLines(money, mail.tUnits);
      const clientInfoLines = moneyInfoLines(money, client.tUnits);
      prep = { whenLine, clientWhenLine, serviceName, infoLines, clientInfoLines };
    } catch (error) {
      console.error("[rentals] post-booking mail prep failed:", error);
      return { ok: true, token, pending: isPending };
    }
    const { whenLine, clientWhenLine, serviceName, infoLines, clientInfoLines } = prep;

    // Best-effort confirmation (the booking survives email failure). Pending:
    // the request-received twin instead — nothing is confirmed yet.
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = isPending
        ? bookingRequestReceivedEmail(client.t, {
            orgName: ctx.org.orgName,
            serviceName,
            whenLine: clientWhenLine,
            manageUrl,
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
            infoLines: clientInfoLines,
          })
        : bookingConfirmationEmail(client.t, {
            orgName: ctx.org.orgName,
            serviceName,
            whenLine: clientWhenLine,
            manageUrl,
            icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
            // "Powered by Booklo" unless the org's plan lets it opt out and it
            // did (emailBadgeUrl swallows its own errors — same discipline as
            // scheduling/public-actions.ts's own confirmation send).
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
            infoLines: clientInfoLines,
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
    // (scheduling/public-actions.ts), reply-to wiring included. The
    // nights/days twin lives in createRentalBooking (public-actions.ts) —
    // the two actions mirror each other.
    // One seam, each member's channels (/notifications); it swallows its own
    // errors, so a failed client mail can't skip it.
    await notifyMembers({
      orgId: ctx.org.orgId,
      event: isPending ? "newRequest" : "newBooking",
      serviceName,
      clientName: name,
      clientEmail: email,
      whenLine,
      note: note ?? null,
      infoLines,
      idempotencyKey: bookingLifecycleKey(bookingId as string, "provider-new"),
    });

    return { ok: true, token, pending: isPending };
  } catch (error) {
    console.error("[rentals] createRentalBookingHours:", error);
    return publicError(orgLocale, "generic");
  }
}
