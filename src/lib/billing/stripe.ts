import "server-only";
import Stripe from "stripe";
import { env } from "@/env";
import { TEAM_INCLUDED_SEATS, type Interval, type PaidPlanId } from "./plans";
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

/** Second chance for a price the env map doesn't know: a rotated or renamed
    price whose `plan`/`interval` metadata we set in the Stripe dashboard
    (§7.12 launch checklist). Only the two enums we understand are accepted —
    anything else is as unmapped as an unknown id. */
export function planFromPriceMetadata(metadata: Record<string, string> | undefined) {
  const plan = metadata?.plan;
  const interval = metadata?.interval;
  if ((plan === "pro" || plan === "team") && (interval === "month" || interval === "year")) {
    return { plan, interval } as { plan: PaidPlanId; interval: Interval };
  }
  return null;
}

type SubLike = {
  id: string; customer: string | { id: string }; status: string; cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string; metadata?: Record<string, string> }; quantity?: number; current_period_end?: number }> };
};

function subscriptionFrom(sub: SubLike, priceMap: PriceMap, forceExpired: boolean): BillingSubscription | null {
  const item = sub.items?.data?.[0];
  if (!item) return null;
  const mapped = planFromPriceId(item.price.id, priceMap) ?? planFromPriceMetadata(item.price.metadata);
  if (!mapped) return null;
  return {
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    providerSubscriptionId: sub.id,
    plan: mapped.plan,
    interval: mapped.interval,
    // Team is a fixed-size plan in this slice; quantity → seats is spec §8 item 3.
    seats: mapped.plan === "team" ? TEAM_INCLUDED_SEATS : 1,
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
      // A deletion whose price maps to nothing still emits with
      // `subscription: null` — apply_billing_event (0043) expires the cached
      // row from the type + org alone, so an unmappable price can no longer
      // leave an org paid-forever in our cache.
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

/** Create a Checkout Session with the Founder discount when there is one, and
    WITHOUT it if that first attempt fails. The coupon is capped
    (`max_redemptions`, spec §7.12): once it runs out — or expires, or is
    archived — Stripe rejects the whole session, which would turn "the promo
    ended" into "you cannot buy Pro". The retry keeps the sale at list price.
    If the retry fails too, the FIRST error is thrown: it is the one that
    describes what actually went wrong when a discount was in play.

    Pure w.r.t. the network (the caller injects `create`), which is the only
    reason this retry has a unit test at all. */
export async function withOptionalDiscount<T>(
  create: (params: Stripe.Checkout.SessionCreateParams) => Promise<T>,
  params: Stripe.Checkout.SessionCreateParams,
  discount: string | undefined,
): Promise<T> {
  if (!discount) return create(params);
  try {
    return await create({ ...params, discounts: [{ promotion_code: discount }] });
  } catch (error) {
    console.warn(
      "[billing] founder code rejected, retrying without it:",
      error instanceof Error ? error.message : String(error),
    );
    try {
      return await create(params);
    } catch {
      throw error;
    }
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
        // Stripe rejects `customer` and `customer_email` together, so this is
        // an either/or: reuse the org's existing customer on a resubscribe,
        // otherwise let Stripe create one from the member's address.
        ...(input.providerCustomerId
          ? { customer: input.providerCustomerId }
          : { customer_email: input.email }),
        metadata: { org_id: input.orgId },
        subscription_data: { metadata: { org_id: input.orgId } },
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        allow_promotion_codes: false,
        managed_payments: { enabled: true }, // API ≥ 2025-03-31.basil (spec §6/§7.1)
      };
      const session = await withOptionalDiscount(
        (p) => stripe.checkout.sessions.create(p),
        params,
        input.discountCode,
      );
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
