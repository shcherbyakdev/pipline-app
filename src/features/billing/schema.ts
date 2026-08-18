import { z } from "zod";

/* What the checkout form is allowed to say. Prices are never trusted from the
   client (spec §7.6): the form sends plan + interval, the provider maps that
   pair to its own price ids. */
export const checkoutInput = z.object({
  plan: z.enum(["pro", "team"]),
  interval: z.enum(["month", "year"]),
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
