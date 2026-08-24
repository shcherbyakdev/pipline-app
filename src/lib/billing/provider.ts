import "server-only";
import { env } from "@/env";
import type { Interval, PaidPlanId } from "./plans";
import type { SubscriptionStatus } from "./entitlements";
import { stripeProvider } from "./stripe";
import { fakeProvider } from "./fake";

// The ONLY vendor decision for billing (email transport idiom): Stripe
// Managed Payments in production, a fake for dev/tests. Adapters normalise
// everything into BillingEvent; the rest of the app never sees a vendor type.
export type ProviderName = "stripe" | "fake";

export type BillingEventType =
  | "subscription_created" | "subscription_updated" | "subscription_cancelled"
  | "subscription_expired" | "payment_failed" | "payment_recovered";

export type BillingSubscription = {
  providerCustomerId: string;
  providerSubscriptionId: string;
  plan: PaidPlanId;
  interval: Interval;
  seats: number;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingEvent = {
  provider: ProviderName;
  providerEventId: string;   // idempotency key
  occurredAt: string;        // ISO from the provider payload
  orgId: string | null;      // from checkout metadata; null = unresolvable
  type: BillingEventType;
  subscription: BillingSubscription | null;
  raw: unknown;              // stored in billing_events.payload
};

export type CheckoutInput = {
  orgId: string; plan: PaidPlanId; interval: Interval; email: string;
  discountCode?: string;
  /** Where the provider sends the member after PAYING. Carries the
      post-purchase markers (`checkout=success&plan=…`) /billing polls on. */
  returnUrl: string;
  /** Where "back"/"cancel" on the hosted checkout goes. A separate URL, not
      `returnUrl`: an abandoned checkout must not land on the success markers
      and sit on "Activating your plan…" for a purchase that never happened. */
  cancelUrl: string;
  /** The org's existing provider customer, when it has one (resubscribe after
      an expired/ended plan). Set → the session attaches to that customer
      instead of creating a second one for the same org. */
  providerCustomerId?: string;
};

export type CheckoutSession = {
  url: string;
  /** The Founder discount was asked for but the provider refused it (the
      code ran out, expired, or was archived) and the session was created at
      list price instead. The caller decides whether to send the member on or
      tell them first — startCheckout tells them (`?error=founder_ended`). */
  founderFallback: boolean;
};

export interface BillingProvider {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  createPortalUrl(providerCustomerId: string, returnUrl: string): Promise<string>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[];
}

export function selectBillingProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === "stripe") return stripeProvider();
  return fakeProvider();
}
