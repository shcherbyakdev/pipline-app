import "server-only";

import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import { tokenLimiter } from "./rate-limit";
import type { Line } from "@/features/rentals/pricing-rules";
import type { CancelPolicy } from "@/features/rentals/cancel-policy";

export type ResolveBookingResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | {
      status: "ok";
      booking: {
        id: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        serviceName: string;
        orgName: string;
        orgTimezone: string;
        orgId: string;
        // Rentals R1: a booking is EITHER an appointment (serviceId set) or a
        // rental stay (rentalUnitId + rangeMode set) — never both.
        serviceId: string | null;
        rentalUnitId: string | null;
        rangeMode: "nights" | "days" | "hours" | null;
        // Team: the assigned staff member (null for rental stays, which have
        // no calendar owner). `staffName` is raw — the solo rule that hides it
        // lives in resolveClientStaffName, applied per surface.
        staffId: string | null;
        staffName: string | null;
        // H3: pricing/deposit info for the money lines. Null across the
        // board for an offering with no price set.
        priceCents: number | null;
        currency: string | null;
        depositCents: number | null;
        // S3: the policy the client accepted (the booking's own snapshot;
        // null for appointments and pre-S3 rows) and the consequence the row
        // carries — a cancellation fee on a dead row, a late-change fee on a
        // live one.
        cancelPolicy: CancelPolicy | null;
        feeCents: number;
        // Approval: the provider's reason for turning a request down (0064).
        // Null for everything that was never declined.
        declineNote: string | null;
        // S1: the quoted line-by-line breakdown and the people count the
        // booking was made for; null for a booking with no quote (flat rate,
        // or made before this slice).
        lines: Line[] | null;
        people: number | null;
        // S2: the hold's deadline (null unless the booking is
        // pending_payment) and what the row says was collected / given back.
        holdExpiresAt: Date | null;
        paidCents: number;
        refundedCents: number;
      };
    };

export async function resolveBookingToken(
  token: string,
  clientKey: string,
): Promise<ResolveBookingResult> {
  // Two buckets: a plain per-client one (audit 2026-08-24 — keyed only on
  // the token prefix, every guess was a fresh bucket, so one IP could drive
  // unlimited resolver RPCs through GET /booking/<x>), then the per-token
  // one that keeps a single hot link from starving the client's other pages.
  if (
    !tokenLimiter.allow(clientKey) ||
    !tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)
  ) {
    return { status: "rate_limited" };
  }
  if (token.length < 20 || token.length > 200) return { status: "not_found" };
  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
  if (error) {
    console.error("[booking] resolve:", error.code || "rpc error");
    return { status: "not_found" };
  }
  const row = (data as Array<{
    booking_id: string;
    booking_status: string;
    starts_at: string;
    ends_at: string;
    service_name: string;
    org_name: string;
    org_timezone: string;
    org_id: string;
    service_id: string | null;
    rental_unit_id: string | null;
    range_mode: "nights" | "days" | "hours" | null;
    staff_id: string | null;
    staff_name: string | null;
    price_cents: number | null;
    currency: string | null;
    deposit_cents: number | null;
    cancel_policy: CancelPolicy | null;
    decline_note: string | null;
    lines: unknown;
    people: number | null;
    hold_expires_at: string | null;
    paid_cents: number;
    refunded_cents: number;
    fee_cents: number;
  }> | null)?.[0];
  if (!row) return { status: "not_found" };
  return {
    status: "ok",
    booking: {
      id: row.booking_id,
      status: row.booking_status,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      serviceName: row.service_name,
      orgName: row.org_name,
      orgTimezone: row.org_timezone,
      orgId: row.org_id,
      serviceId: row.service_id,
      rentalUnitId: row.rental_unit_id,
      rangeMode: row.range_mode,
      staffId: row.staff_id ?? null,
      staffName: row.staff_name ?? null,
      priceCents: row.price_cents,
      currency: row.currency,
      depositCents: row.deposit_cents,
      cancelPolicy: row.cancel_policy ?? null,
      feeCents: row.fee_cents ?? 0,
      declineNote: row.decline_note,
      lines: (row.lines as Line[] | null) ?? null,
      people: row.people ?? null,
      holdExpiresAt: row.hold_expires_at ? new Date(row.hold_expires_at) : null,
      paidCents: row.paid_cents ?? 0,
      refundedCents: row.refunded_cents ?? 0,
    },
  };
}

export function buildBookingManageUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/booking/${token}`;
}
