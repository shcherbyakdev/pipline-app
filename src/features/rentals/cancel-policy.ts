// S3: tiered change consequences (spec 2026-09-07-s3-change-consequences).
// The TypeScript twin of public.cancel_fee_pct (0081). SQL is authoritative
// for every write; this module computes PREVIEWS (the manage page, the
// reschedule panels) and the admin dialog's default, and the lockstep test
// (change-consequences.integration.test.ts) fails if the two drift.
import { z } from "zod";
import type { UnitsT } from "@/i18n/translator";

export type CancelTier = { beforeMin: number; feePct: number };
export type CancelPolicy = CancelTier[];

export const CANCEL_POLICY_MAX_TIERS = 5;

export const cancelTierSchema = z.object({
  // Minutes before start; 527040 = 366 days, the cancel-window cap H3 used.
  beforeMin: z.number().int().min(0).max(527040),
  feePct: z.number().int().min(0).max(100),
});

/** Sorted descending by lead on the way in (the editor may hand rows in any
    order); duplicate leads are refused rather than silently merged. */
export const cancelPolicySchema = z
  .array(cancelTierSchema)
  .max(CANCEL_POLICY_MAX_TIERS)
  .transform((tiers) => [...tiers].sort((a, b) => b.beforeMin - a.beforeMin))
  .refine((tiers) => new Set(tiers.map((t) => t.beforeMin)).size === tiers.length, {
    message: "duplicate tier",
  });

/** The percentage in force at `at` for a booking starting at `startsAt`:
    the tier with the largest lead the moment still meets; none → 100;
    empty → 0. Mirror of public.cancel_fee_pct — keep the two in lockstep. */
export function cancelFeePct(policy: CancelPolicy | null, startsAt: Date, at: Date): number {
  const tiers = policy ?? [];
  if (tiers.length === 0) return 0;
  const lead = startsAt.getTime() - at.getTime();
  const met = [...tiers]
    .filter((t) => lead >= t.beforeMin * 60_000)
    .sort((a, b) => b.beforeMin - a.beforeMin)[0];
  return met ? met.feePct : 100;
}

/** `round(total × pct / 100)` — identical to the SQL for non-negative halves. */
export function cancelFeeCents(
  policy: CancelPolicy | null,
  totalCents: number | null,
  startsAt: Date,
  at: Date,
): number {
  if (totalCents === null) return 0;
  return Math.round((totalCents * cancelFeePct(policy, startsAt, at)) / 100);
}

/** "3 days" / "48 hours" / "1.5 hours" for a lead in minutes (H3). */
export function formatCancelWindow(min: number, t: UnitsT): string {
  if (min % 1440 === 0) return t("days", { count: min / 1440 });
  const h = min / 60;
  return t("hours", { count: Number.isInteger(h) ? h : Math.round(h * 10) / 10 });
}

/** One line for the policy, or null when there is none: every tier is a
    segment (free-until / pct-until / pct-after for a lead of 0) and a
    policy whose smallest lead is above 0 ends in the implicit 100%. */
export function formatCancelPolicy(policy: CancelPolicy | null, t: UnitsT): string | null {
  const tiers = policy ?? [];
  if (tiers.length === 0) return null;
  const parts: string[] = [];
  for (const tier of tiers) {
    if (tier.beforeMin === 0) parts.push(t("policyAfter", { pct: tier.feePct }));
    else if (tier.feePct === 0) parts.push(t("policyFree", { window: formatCancelWindow(tier.beforeMin, t) }));
    else parts.push(t("policyTier", { pct: tier.feePct, window: formatCancelWindow(tier.beforeMin, t) }));
  }
  if (tiers[tiers.length - 1]!.beforeMin > 0) parts.push(t("policyAfter", { pct: 100 }));
  return parts.join(" · ");
}

export type AdminRefundMode = "policy" | "all" | "none";

/** The admin cancel dialog's three choices (spec decision 3), on what the
    row says was paid and already refunded. `none` keeps what was paid as
    the fee; `all` waives it; `policy` applies the tier. */
export function adminCancelMoney(
  mode: AdminRefundMode,
  b: {
    cancelPolicy: CancelPolicy | null;
    priceCents: number | null;
    startsAt: Date;
    paidCents: number;
    refundedCents: number;
  },
  at: Date,
): { feeCents: number; refundCents: number } {
  const held = Math.max(0, b.paidCents - b.refundedCents);
  switch (mode) {
    case "all":
      return { feeCents: 0, refundCents: held };
    case "none":
      return { feeCents: held, refundCents: 0 };
    case "policy": {
      const feeCents = cancelFeeCents(b.cancelPolicy, b.priceCents, b.startsAt, at);
      return { feeCents, refundCents: Math.max(0, held - feeCents) };
    }
  }
}
