import { env } from "@/env";

/* The Founder promo (spec §3): every org created before the public-launch
   cutoff gets Pro at the coupon price, for life. One rule, two callers — the
   checkout action (which turns it into a discount code) and the /billing
   overview (which decides whether to offer the ribbon). */
export function isFounderEligible(createdAt: string | null | undefined): boolean {
  if (!env.BILLING_FOUNDER_PROMO_CODE || !env.BILLING_FOUNDER_CUTOFF || !createdAt) return false;
  return Date.parse(createdAt) < Date.parse(`${env.BILLING_FOUNDER_CUTOFF}T00:00:00Z`);
}
