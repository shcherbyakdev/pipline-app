import "server-only";
import Stripe from "stripe";
import { env } from "@/env";
import { TEAM_INCLUDED_RESOURCES, type Interval, type PaidPlanId } from "./plans";
import type { SubscriptionStatus } from "./entitlements";
import type { BillingEvent, BillingProvider, BillingSubscription, CheckoutInput, CheckoutSession } from "./provider";

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

/** `metadata.org_id` is ours (startCheckout sets it on the subscription),
    but Stripe metadata is free text the dashboard can edit, and
    apply_billing_event takes it as `uuid`: anything that is not one would
    make the RPC raise (22P02) — a 500 for every retry of that event. Not a
    UUID ⇒ null, which the RPC records as 'unresolvable org' and moves on. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orgIdFromMetadata(metadata: Record<string, string> | undefined): string | null {
  const id = metadata?.org_id;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
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
    seats: mapped.plan === "team" ? TEAM_INCLUDED_RESOURCES : 1,
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
      const created = event.type === "customer.subscription.created";
      const deleted = event.type === "customer.subscription.deleted";
      // A subscription is born `incomplete` when Checkout has to confirm the
      // payment first, and Stripe emits created(incomplete) and
      // updated(active) inside the same second. mapStripeStatus reads
      // `incomplete` as expired, and apply_billing_event breaks same-second
      // ties by ARRIVAL — so if the `created` were delivered second it would
      // overwrite the active row with an expired one. The `updated` is the
      // source of truth; the `created` says nothing it doesn't.
      if (created && (sub.status === "incomplete" || sub.status === "incomplete_expired")) return null;
      const subscription = subscriptionFrom(sub, priceMap, deleted);
      // A deletion whose price maps to nothing still emits with
      // `subscription: null` — apply_billing_event (0043) expires the cached
      // row from the type + org alone, so an unmappable price can no longer
      // leave an org paid-forever in our cache.
      //
      // A LIVE subscription on a price we can't map is different: nothing
      // safe can be projected from it, and answering 200 would have Stripe
      // consider the event delivered — the org would pay without a plan and
      // no retry would ever come (a dashboard resend hits the
      // billing_events unique index and returns 'replayed'). Throw instead:
      // the route answers non-2xx, Stripe keeps retrying, and the retries
      // succeed the moment the price id is added to the env map or given
      // plan/interval metadata (§7.12).
      if (!subscription && !deleted) {
        const priceId = sub.items?.data?.[0]?.price.id;
        if (priceId) throw new Error(`unmapped price ${priceId}`);
      }
      return {
        ...base,
        orgId: orgIdFromMetadata(sub.metadata),
        type: deleted ? "subscription_expired" : created ? "subscription_created" : "subscription_updated",
        subscription,
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

/** Is this Stripe's "the discount is the problem" — and nothing else?
    Stripe reports a promotion code that ran out, expired, was archived or
    doesn't cover the price as an invalid_request_error whose `param` is
    under `discounts[…]`, or whose message names the code/coupon. Anything
    else (a bad API key, a wrong price id, a network failure) is a checkout
    problem the discount had nothing to do with, and retrying without the
    discount would only sell at list price into whatever is broken. */
export function isDiscountRejection(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    (Boolean(error.param?.startsWith("discounts")) || /promotion|coupon/i.test(error.message))
  );
}

/** Create a Checkout Session with the Founder discount when there is one, and
    WITHOUT it if Stripe rejects the discount. The coupon is capped
    (`max_redemptions`, spec §7.12): once it runs out — or expires, or is
    archived — Stripe rejects the whole session, which would turn "the promo
    ended" into "you cannot buy Pro". The retry at list price proves the sale
    itself is fine, and `founderFallback: true` tells the caller the member
    is NOT getting the price they were shown — startCheckout stops and says
    so rather than sending them on to pay more than the page promised.

    Only a discount rejection (isDiscountRejection) retries; every other
    error is rethrown as-is. If the retry fails too, the FIRST error is
    thrown: it is the one that describes what actually went wrong when a
    discount was in play.

    Pure w.r.t. the network (the caller injects `create`), which is the only
    reason this retry has a unit test at all. */
export async function withOptionalDiscount<T>(
  create: (params: Stripe.Checkout.SessionCreateParams) => Promise<T>,
  params: Stripe.Checkout.SessionCreateParams,
  discount: string | undefined,
): Promise<{ session: T; founderFallback: boolean }> {
  if (!discount) return { session: await create(params), founderFallback: false };
  try {
    return { session: await create({ ...params, discounts: [{ promotion_code: discount }] }), founderFallback: false };
  } catch (error) {
    if (!isDiscountRejection(error)) throw error;
    console.warn(
      "[billing] founder code rejected, retrying without it:",
      error instanceof Error ? error.message : String(error),
    );
    try {
      return { session: await create(params), founderFallback: true };
    } catch {
      throw error;
    }
  }
}

/** The Checkout Session, minus the discount `withOptionalDiscount` adds.
    Exported so the shape has a test that does not need the network — which
    is how the rule below is kept: Stripe refuses a session carrying BOTH
    `allow_promotion_codes` and `discounts` ("You may only specify one of
    these parameters"), even with the flag set to false. It was set to false,
    so every Founder checkout was rejected, retried at list price, and told
    the member the promo had ended — with the code still at 0 redemptions
    (test-mode walk 2026-09-10). Omitting the flag IS false: customers cannot
    type a code, and startCheckout applies the Founder one by id. */
export function checkoutParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  return {
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
    cancel_url: input.cancelUrl,
    managed_payments: { enabled: true }, // API ≥ 2025-03-31.basil (spec §6/§7.1)
  };
}

export function stripeProvider(): BillingProvider {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const priceMap = priceMapFromEnv();
  return {
    name: "stripe",
    async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
      const { session, founderFallback } = await withOptionalDiscount(
        (p) => stripe.checkout.sessions.create(p),
        checkoutParams(input),
        input.discountCode,
      );
      if (!session.url) throw new Error("stripe: no checkout url");
      return { url: session.url, founderFallback };
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
