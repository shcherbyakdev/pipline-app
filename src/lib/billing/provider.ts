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
  discountCode?: string; returnUrl: string;
  /** The org's existing provider customer, when it has one (resubscribe after
      an expired/ended plan). Set → the session attaches to that customer
      instead of creating a second one for the same org. */
  providerCustomerId?: string;
};

export interface BillingProvider {
  readonly name: ProviderName;
  createCheckoutUrl(input: CheckoutInput): Promise<string>;
  createPortalUrl(providerCustomerId: string, returnUrl: string): Promise<string>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[];
}

export function selectBillingProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === "stripe") return stripeProvider();
  return fakeProvider();
}
