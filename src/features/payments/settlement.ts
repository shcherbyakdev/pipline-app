// S7: after-session charges and settlement (spec 2026-09-08). Pure twins
// of the SQL: balanceCents mirrors public.booking_balance_cents (0082) and
// the lockstep test (settlement.integration.test.ts) fails if they drift.
import { z } from "zod";
import type { Line } from "@/features/rentals/pricing-rules";

export const CHARGE_KINDS = ["overtime", "people", "cleaning", "damage", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export type Charge = {
  id: string;
  kind: ChargeKind;
  label: string;
  qty: number;
  unitCents: number;
  cents: number;
  note: string | null;
};

export const chargeInput = z.object({
  bookingId: z.uuid(),
  kind: z.enum(CHARGE_KINDS),
  label: z.string().trim().min(1).max(80),
  qty: z.number().int().min(1).max(99),
  unitCents: z.number().int().min(0).max(10_000_000),
  note: z.string().trim().max(500).optional(),
});

/** balance = price + fee + charges − write-off − (paid − refunded). Negative = overpaid. */
export function balanceCents(b: {
  priceCents: number | null;
  feeCents: number;
  chargesCents: number;
  writtenOffCents: number;
  paidCents: number;
  refundedCents: number;
}): number {
  return (b.priceCents ?? 0) + b.feeCents + b.chargesCents - b.writtenOffCents - (b.paidCents - b.refundedCents);
}

/** The booking's own hourly rate for the overtime helper: a rules-priced
    booking's base line unit; else the flat total spread over its hours. */
export function hourlyRateCents(b: {
  lines: Line[] | null;
  priceCents: number | null;
  startsAt: Date;
  endsAt: Date;
}): number | null {
  const base = b.lines?.find((l) => l.kind === "base");
  if (base && base.unitCents !== null) return base.unitCents;
  if (b.priceCents === null) return null;
  const hours = (b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000;
  return hours > 0 ? Math.round(b.priceCents / hours) : null;
}

/** Overtime in started 30-minute blocks at half the hourly rate (half-up). */
export function overtimeCharge(minutes: number, rateCents: number): { qty: number; unitCents: number; cents: number } {
  const qty = Math.max(0, Math.ceil(minutes / 30));
  const unitCents = Math.round(rateCents / 2);
  return { qty, unitCents, cents: qty * unitCents };
}
