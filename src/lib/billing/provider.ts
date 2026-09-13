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

/** A change to a subscription that already EXISTS. Plan and interval move
    together because a price is a (plan, interval) pair: switching one without
    naming the other would ask the provider for a price we can't resolve.
    `cancel`/`resume` flip the scheduled end, they never delete anything —
    a cancelled plan runs to the end of the period it was paid for. */
export type SwitchChange = { kind: "switch"; plan: PaidPlanId; interval: Interval };

export type SubscriptionChange = SwitchChange | { kind: "cancel" } | { kind: "resume" };

export type CheckoutSession = {
  url: string;
  /** The Founder discount was asked for but the provider refused it (the
      code ran out, expired, or was archived) and the session was created at
      list price instead. The caller decides whether to send the member on or
      tell them first — startCheckout tells them (`?error=founder_ended`). */
  founderFallback: boolean;
};

/** What a switch costs, in minor units of `currency`, as the provider would
    bill it the moment it is asked. Shown BEFORE the click that spends money
    — the confirmation is the whole point, so a number we are unsure of is
    worse than none: `dueToday` is what the provider says it will collect
    now, and nothing is inferred from it. */
export type ChangePreview = {
  dueToday: number;
  currency: string;
};

/** Which portal screen to open. Only the card form is ours to hand over —
    everything else the portal can do, /billing now does itself. */
export type PortalFlow = "payment_method";

export interface BillingProvider {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** Apply `change` to the org's existing subscription and answer with what
      it became. The answer is the point: the caller projects it through the
      SAME `applyBillingEvents` a webhook goes through, so /billing is right
      on the next render instead of polling for a delivery that is seconds
      away. The provider's own event still arrives and lands as a no-op
      (apply_billing_event orders by `occurred_at`).

      `current` is our cached row — it carries the ids and saves the adapter
      a read it would otherwise make just to find them. */
  updateSubscription(current: BillingSubscription, change: SubscriptionChange): Promise<BillingSubscription>;
  /** What `change` would cost if applied right now. Read-only: it must not
      create, alter or reserve anything at the provider. */
  previewChange(current: BillingSubscription, change: SwitchChange): Promise<ChangePreview>;
  /** The provider's hosted portal. The ONE screen we don't build: entering a
      card needs Elements, which Managed Payments doesn't support, so the
      card form stays Stripe's (`flow: "payment_method"` deep-links to it). */
  createPortalUrl(providerCustomerId: string, returnUrl: string, flow?: PortalFlow): Promise<string>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[];
}

export function selectBillingProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === "stripe") return stripeProvider();
  return fakeProvider();
}
