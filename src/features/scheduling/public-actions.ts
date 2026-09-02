"use server";

import { publicError, type OrgLocaleSource } from "@/i18n/public";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter, publicSlotsLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingOrg,
  loadOrgSlotContext,
  countActiveStaff,
  resolveClientStaffName,
} from "@/lib/booking/public";
import { loadPublicOffering } from "@/lib/booking/public-offering";
import { chooseStaffForBooking } from "@/lib/booking/bookable";
import { sendStaffNotice } from "@/lib/booking/staff-notice";
import { getProviderEmail } from "@/lib/booking/provider";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { addDaysISO, computeSlots, dateInZone, unionSlots } from "./slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  bookingRequestReceivedEmail,
  providerNewBookingEmail,
  formatWhenLine,
} from "./templates";
import { getSlotsInput, createBookingInput } from "./schema";
import { SLOT_TAKEN, slotLostMessage, type SlotLostKey } from "./booking-errors";



// Two buckets (rate-limit.ts): browsing weeks is cheap and frequent, a
// booking is an RPC plus emails.
async function limited(kind: "slots" | "booking"): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !(kind === "slots" ? publicSlotsLimiter : publicBookingLimiter).allow(key);
}

// slotLostMessage (booking-errors.ts) holds the rule; this only feeds it the
// count. "any" short-circuits so the common case costs no query, and a count
// that blows up degrades to the solo wording — never to copy about a team the
// org may not have.
async function slotLostError(orgId: string, staffId: string): Promise<SlotLostKey> {
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
  // The org-mode gate (offers_appointments) decides what the org sells: a
  // channel it doesn't offer must not disclose availability either.
  if (!org.offersAppointments) return null;
  // The plan's public roster decides who the public may reach — a person the
  // org can no longer offer publicly must not surface slots or take bookings.
  const offering = await loadPublicOffering(org.orgId);
  const bookableIds = offering.staff.map((s) => s.id);
  const ctx = await loadOrgSlotContext(org.orgId, serviceId, fromDate, days, {
    staffId,
    allowedStaffIds: bookableIds,
  });
  if (!ctx) return null;
  return {
    org,
    service: ctx.service,
    perStaff: ctx.perStaff,
    bookableIds,
    eligibleStaffIds: ctx.eligibleStaffIds,
  };
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

// On a team org the provider (org owner) may also be a staff row with the
// same address — one booking, one mail. Read-only and best-effort.
async function isStaffTheProvider(
  orgId: string,
  staffId: string,
  providerEmail: string | null,
): Promise<boolean> {
  if (!providerEmail) return false;
  try {
    const { data } = await createAdminClient()
      .from("staff")
      .select("email")
      .eq("id", staffId)
      .eq("org_id", orgId)
      .maybeSingle();
    return (data?.email ?? "").trim().toLowerCase() === providerEmail.trim().toLowerCase();
  } catch {
    return false;
  }
}

export async function getSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited("slots")) return publicError(orgLocale, "tooManyRequests");
  const parsed = getSlotsInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
  const { handle, serviceId, fromDate, days, staffId } = parsed.data;
  try {
    // `fromDate` is the VIEWER's local date (the widget groups by viewer
    // day); the engine walks ORG-local dates. Pad a day on each side so a
    // viewer far west or east of the org still sees every slot that falls on
    // their own days — the widget keeps only what lands inside its page, and
    // `notBefore` has already dropped the past.
    const from = addDaysISO(fromDate, -1);
    const span = days + 2;
    const ctx = await loadSlotContext(handle, serviceId, from, span, staffId);
    if (!ctx) return publicError(orgLocale, "generic");
    const slots = unionSlots(slotsPerStaff(ctx, from, span));
    return { ok: true, slots: slots.map((s) => s.startsAt.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getSlots:", error);
    return publicError(orgLocale, "generic");
  }
}

export async function createBooking(
  input: unknown,
): Promise<
  | { ok: true; token: string; staffName: string | null; pending: boolean }
  | { ok: false; error: string; slotTaken?: boolean }
> {
  let orgLocale: OrgLocaleSource = null;
  if (await limited("booking")) return publicError(orgLocale, "tooManyRequests");
  const parsed = createBookingInput.safeParse(input);
  if (!parsed.success) return publicError(orgLocale, "generic");
  // getBookingOrg is memoised per request: the loaders below re-use this read.
  orgLocale = () => getBookingOrg(parsed.data.handle).then((o) => o?.locale ?? null);
  const { handle, serviceId, startsAt, name, email, note, staffId } = parsed.data;

  try {
    const starts = new Date(startsAt);
    const ctx = await loadSlotContext(handle, serviceId, dateInZone(starts, "UTC"), 2, staffId);
    if (!ctx) return publicError(orgLocale, "generic");

    // Re-run the engine for the org-local day of the requested slot; the
    // requested instant must be in the union of the eligible staff's outputs.
    // The EXCLUDE constraint remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = unionSlots(slotsPerStaff(ctx, localDate, 1));
    const match = slots.find((s) => s.startsAt.getTime() === starts.getTime());
    if (!match) {
      return publicError(orgLocale, await slotLostError(ctx.org.orgId, staffId), { slotTaken: true });
    }

    const { token, tokenHash } = generateAccessToken();
    // 0052: create_booking left the anon grant surface — the engine re-check
    // above (min notice, buffers, grid, max/day, plan roster) is the only
    // entry, so this action calls it as service_role. The DB keeps its own
    // last lines: org/service/staff membership, containment, EXCLUDE.
    const admin = createAdminClient();
    const choice = chooseStaffForBooking({
      staffId,
      bookableIds: ctx.bookableIds,
      eligibleStaffIds: ctx.eligibleStaffIds,
      freeStaffIdsAtSlot: match.staffIds,
    });
    const { data, error } = await admin.rpc("create_booking", {
      p_handle: handle,
      p_service_id: serviceId,
      p_starts_at: starts.toISOString(),
      p_name: name,
      p_email: email,
      p_note: note ?? null,
      p_token_hash: tokenHash,
      // A named person, or null + the engine's free set for the DB to rank
      // inside (chooseStaffForBooking).
      p_staff_id: choice.staffId,
      p_candidates: choice.candidates,
    });
    if (error) {
      // Per-email hourly cap (0052) — say so; "try again" would be a lie.
      if (isRpcSentinel(error, "too_many")) return publicError(orgLocale, "tooManyForEmail");
      // The RPC raises a bare `staff_unavailable` when a NAMED staff member
      // cannot take the slot; `taken`/23P01 is the classic race. Solo orgs
      // reach the first branch too (they send a named id), so the wording is
      // decided by the same count as the pre-flight check above.
      if (isRpcSentinel(error, "staff_unavailable")) {
        return publicError(orgLocale, await slotLostError(ctx.org.orgId, staffId), { slotTaken: true });
      }
      if (isRpcSentinel(error, "taken") || error.code === "23P01") {
        return publicError(orgLocale, "slotTaken", { slotTaken: true });
      }
      console.error("[scheduling] createBooking:", error.code || "rpc error");
      return publicError(orgLocale, "generic");
    }
    // create_booking RETURNS TABLE — one row of (booking_id, staff_id, staff_name).
    const row = (data as unknown as
      | { booking_id: string; staff_id: string; staff_name: string }[]
      | null)?.[0];
    if (!row) {
      console.error("[scheduling] createBooking: rpc returned no row");
      return publicError(orgLocale, "generic");
    }

    // The RPC decided under the flag it read at insert time — one select
    // keeps the emails honest even if the toggle flips mid-flight.
    const { data: statusRow, error: statusError } = await admin
      .from("bookings").select("status").eq("id", row.booking_id).maybeSingle();
    if (statusError) console.error("[scheduling] createBooking status read:", statusError);
    const isPending = statusRow?.status === "pending";

    // Solo orgs never name a staff member (resolveClientStaffName holds that
    // rule, and degrades to the unnamed copy if the count blows up — past this
    // point the booking EXISTS and nothing may fail the action).
    const staffName = await resolveClientStaffName(ctx.org.orgId, row.staff_name);
    const whenLine = formatWhenLine(starts, ctx.org.timeZone);
    const idempotencyKey = bookingIdempotencyKey(row.booking_id);
    // Best-effort like everything below: a null provider address only means
    // the client's mail carries no reply-to and the provider copy is skipped.
    const providerEmail = await getProviderEmail(ctx.org.orgId).catch((e) => {
      console.error("[scheduling] getProviderEmail:", e);
      return null;
    });

    // Best-effort confirmation (spec: the booking survives email failure;
    // S2's drain adds retries). Pending: the request-received twin instead —
    // nothing is confirmed and nothing is on a calendar yet.
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = isPending
        ? bookingRequestReceivedEmail({
            orgName: ctx.org.orgName,
            serviceName: ctx.service.name,
            whenLine,
            manageUrl,
            staffName,
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
          })
        : bookingConfirmationEmail({
            orgName: ctx.org.orgName,
            serviceName: ctx.service.name,
            whenLine,
            manageUrl,
            icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
            staffName,
            // "Powered by Booklo" unless the org's plan lets it opt out and it
            // did (emailBadgeUrl swallows its own errors — same discipline as
            // resolveClientStaffName above: the booking is already committed).
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
          });
      await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        // Replies go to the provider, not the no-reply sender.
        replyTo: providerEmail ?? undefined,
        idempotencyKey,
      });
    } catch (mailError) {
      console.error("[scheduling] confirmation email failed:", mailError);
    }

    // The provider's own copy — the org owner, whoever the booking landed
    // with (audit 2026-08-24: solo providers previously got nothing at all).
    // Its own try so a failed client mail can't skip it.
    if (providerEmail) {
      try {
        const notice = providerNewBookingEmail({
          serviceName: ctx.service.name,
          clientName: name,
          clientEmail: email,
          whenLine,
          staffName,
          note: note ?? null,
          pending: isPending,
        });
        await selectTransport().send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          replyTo: email,
          idempotencyKey: bookingLifecycleKey(row.booking_id, "provider-new"),
        });
      } catch (mailError) {
        console.error("[scheduling] provider notice failed:", mailError);
      }
    }

    // Staff-side heads-up (never throws, swallows its own errors). Solo orgs
    // are unaffected: sendStaffNotice itself skips orgs with <= 1 active staff,
    // where the provider notice already says the same thing. Team orgs: the
    // assigned member gets theirs unless they ARE the provider address.
    // Pending requests stay quiet: the member hears about it on accept, when
    // there is actually something in their day (Task 7).
    if (!isPending && !(await isStaffTheProvider(ctx.org.orgId, row.staff_id, providerEmail))) await sendStaffNotice({
      orgId: ctx.org.orgId,
      staffId: row.staff_id,
      kind: "new",
      serviceName: ctx.service.name,
      clientName: name,
      whenLine,
      idempotencyKey,
    });

    return { ok: true, token, staffName, pending: isPending };
  } catch (error) {
    console.error("[scheduling] createBooking:", error);
    return publicError(orgLocale, "generic");
  }
}
