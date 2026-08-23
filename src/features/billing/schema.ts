import { z } from "zod";

/* What the checkout form is allowed to say. Prices are never trusted from the
   client (spec §7.6): the form sends plan + interval, the provider maps that
   pair to its own price ids. */
export const checkoutInput = z.object({
  plan: z.enum(["pro", "team"]),
  interval: z.enum(["month", "year"]),
  /** "skip": don't ask the provider for the Founder discount. The picker
      sends it after `?error=founder_ended` — the org is still eligible by
      creation date, so without it every retry would ask for the same
      exhausted code, be refused, and bounce back to the same line forever.
      Hand-crafting it only ever costs the sender the discount. */
  founder: z.enum(["skip"]).optional(),
});

/* A plain `<form action={serverAction}>` discards whatever the action returns,
   so a failed checkout/portal hop comes back as `/billing?error=<code>` and
   the page renders the matching line (ruling 2026-08-18 — the ActionState
   shape would need a client wrapper around every column, and nothing else on
   this page wants one). */
export const BILLING_ERRORS = {
  checkout: "Couldn't open checkout — try again.",
  // A paid org that reaches startCheckout anyway (stale tab, hand-crafted
  // POST): a second checkout would buy a SECOND subscription next to the one
  // it already pays for, so the answer is the portal, where the switch is a
  // proration on the existing one.
  use_portal: "Change plans in the billing portal.",
  // A comped org reaching startCheckout (stale tab, or the picker rendered
  // before the comp was granted): an unexpired override wins outright at the
  // seam, so the purchase would bill a card for entitlements nobody reads.
  complimentary: "Your plan is complimentary right now — there's nothing to buy until it ends.",
  // The Founder code ran out (or expired/was archived) between the page
  // showing the Founder price and the provider being asked for it. The
  // session at list price exists (stripe.ts#withOptionalDiscount), but the
  // member was promised a different number: say so and let them buy again
  // at the price now shown — the picker drops the ribbon and sends
  // `founder=skip` (checkoutInput) so the retry doesn't loop here.
  founder_ended: "The Founder offer has ended — the regular price applies.",
  portal: "There's no subscription to manage yet.",
  portal_unavailable: "Couldn't open the billing portal — try again.",
} as const;

export type BillingErrorCode = keyof typeof BILLING_ERRORS;

/** The line to show for `?error=`; null for a missing or unknown code. */
export function billingErrorMessage(code: string | string[] | undefined): string | null {
  return typeof code === "string" && code in BILLING_ERRORS
    ? BILLING_ERRORS[code as BillingErrorCode]
    : null;
}
