import "server-only";
import Stripe from "stripe";
import { env } from "@/env";
import type { Interval, PaidPlanId } from "./plans";
import type { SubscriptionStatus } from "./entitlements";
import type { BillingEvent, BillingProvider, BillingSubscription, CheckoutInput } from "./provider";

// Stripe Managed Payments (spec §6/§7.1). The ONLY file in src/ that imports
// the stripe SDK. Stripe is the merchant of record: Checkout Session in
// subscription mode with managed_payments enabled; the Customer Portal
// handles cancel/interval/plan switches; webhooks project state onto our
// cache. Everything below the two exported pure mappers is I/O.

export type PriceMap = Record<string, { plan: PaidPlanId; interval: Interval }>;

export function priceMapFromEnv(): PriceMap {
  const m: PriceMap = {};
  if (env.STRIPE_PRICE_PRO_MONTH) m[env.STRIPE_PRICE_PRO_MONTH] = { plan: "pro", interval: "month" };
  if (env.STRIPE_PRICE_PRO_YEAR) m[env.STRIPE_PRICE_PRO_YEAR] = { plan: "pro", interval: "year" };
  if (env.STRIPE_PRICE_TEAM_MONTH) m[env.STRIPE_PRICE_TEAM_MONTH] = { plan: "team", interval: "month" };
  if (env.STRIPE_PRICE_TEAM_YEAR) m[env.STRIPE_PRICE_TEAM_YEAR] = { plan: "team", interval: "year" };
  return m;
}

export function priceIdFor(plan: PaidPlanId, interval: Interval): string {
  const id = plan === "pro"
    ? (interval === "month" ? env.STRIPE_PRICE_PRO_MONTH : env.STRIPE_PRICE_PRO_YEAR)
    : (interval === "month" ? env.STRIPE_PRICE_TEAM_MONTH : env.STRIPE_PRICE_TEAM_YEAR);
  if (!id) throw new Error(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()} unset`);
  return id;
}

export function mapStripeStatus(status: string): SubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  return "expired"; // canceled | unpaid | incomplete | incomplete_expired | paused
}

export function planFromPriceId(priceId: string, priceMap: PriceMap) {
  return priceMap[priceId] ?? null;
}

type SubLike = {
  id: string; customer: string | { id: string }; status: string; cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string }; quantity?: number; current_period_end?: number }> };
};

function subscriptionFrom(sub: SubLike, priceMap: PriceMap, forceExpired: boolean): BillingSubscription | null {
  const item = sub.items?.data?.[0];
  if (!item) return null;
  const mapped = planFromPriceId(item.price.id, priceMap);
  if (!mapped) return null;
  return {
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    providerSubscriptionId: sub.id,
    plan: mapped.plan,
    interval: mapped.interval,
    seats: mapped.plan === "team" ? 5 : 1, // Team fixed at 5 seats in this slice; quantity → seats is spec §8 item 3
    status: forceExpired ? "expired" : mapStripeStatus(sub.status),
    currentPeriodEnd: item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

export function normalizeStripeEvent(event: Stripe.Event, priceMap: PriceMap): BillingEvent | null {
  const base = {
    provider: "stripe" as const,
    providerEventId: event.id,
    occurredAt: new Date(event.created * 1000).toISOString(),
    raw: event,
  };
  const obj = event.data.object as unknown;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = obj as SubLike;
      const deleted = event.type === "customer.subscription.deleted";
      return {
        ...base,
        orgId: sub.metadata?.org_id ?? null,
        type: deleted ? "subscription_expired" : event.type === "customer.subscription.created" ? "subscription_created" : "subscription_updated",
        subscription: subscriptionFrom(sub, priceMap, deleted),
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      // Deliberately ignored: Stripe flips the subscription's status on
      // payment failure/recovery and emits customer.subscription.updated
      // for it, so that single event is our source for past_due/active —
      // no re-fetch, one source of truth.
      return null;
    }
    default:
      return null;
  }
}

export function stripeProvider(): BillingProvider {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const priceMap = priceMapFromEnv();
  return {
    name: "stripe",
    async createCheckoutUrl(input: CheckoutInput) {
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: [{ price: priceIdFor(input.plan, input.interval), quantity: 1 }],
        client_reference_id: input.orgId,
        customer_email: input.email,
        metadata: { org_id: input.orgId },
        subscription_data: { metadata: { org_id: input.orgId } },
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        allow_promotion_codes: false,
        managed_payments: { enabled: true }, // API ≥ 2025-03-31.basil (spec §6/§7.1)
        ...(input.discountCode ? { discounts: [{ promotion_code: input.discountCode }] } : {}),
      };
      const session = await stripe.checkout.sessions.create(params);
      if (!session.url) throw new Error("stripe: no checkout url");
      return session.url;
    },
    async createPortalUrl(providerCustomerId, returnUrl) {
      const s = await stripe.billingPortal.sessions.create({ customer: providerCustomerId, return_url: returnUrl });
      return s.url;
    },
    parseWebhook(rawBody, headers) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET unset");
      const sig = headers.get("stripe-signature") ?? "";
      const event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET); // throws on bad signature
      const normalized = normalizeStripeEvent(event, priceMap);
      return normalized ? [normalized] : [];
    },
  };
}
