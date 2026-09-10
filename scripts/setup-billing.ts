/**
 * Booklo's own subscriptions in Stripe: products, prices, the Founder promo
 * and the Customer Portal configuration, in one idempotent run.
 *
 *   STRIPE_SECRET_KEY=sk_test_… npx tsx scripts/setup-billing.ts
 *   STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/setup-billing.ts --live
 *
 * Prints the env block to paste into .env.local (test) or Vercel Production
 * (live). Re-running finds what it made last time (prices by `lookup_key`,
 * everything else by a `booklo` metadata tag) and updates instead of
 * duplicating — a second run is safe, and is how a price change is rolled
 * out (see the rotation note in the output).
 *
 * This is the BILLING account (Stripe Managed Payments, spec
 * 2026-08-18-pricing-and-billing-design §7.12). NOT the Connect platform
 * that collects client deposits — that is a different Stripe account with
 * its own keys (docs/runbook-production.md §10).
 */
import { loadEnvFile } from "node:process";
import Stripe from "stripe";
import { FOUNDER_PRICE_FACTOR, PLANS, type Interval, type PaidPlanId } from "../src/lib/billing/plans";

try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env is fine.
}

/** SaaS, business use (spec §7.12): the tax code both products carry. */
const TAX_CODE = "txcd_10103001";
/** The promotion code customers never type: startCheckout applies it by id. */
const FOUNDER_CODE = "FOUNDER";
const FOUNDER_MAX_REDEMPTIONS = 100;

const live = process.argv.includes("--live");

/** Live money is one flag away from test money: say it out loud, both ways. */
function requireKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY unset (test mode: sk_test_… from Developers → API keys)");
  if (key.startsWith("sk_live") && !live) throw new Error("that is a LIVE key — re-run with --live if you mean it");
  if (!key.startsWith("sk_live") && live) throw new Error("--live passed with a test key");
  return key;
}

const amountCents = (plan: PaidPlanId, interval: Interval) =>
  Math.round((interval === "month" ? PLANS[plan].monthly : PLANS[plan].yearly) * 100);

async function findOrCreateProduct(stripe: Stripe, plan: PaidPlanId): Promise<string> {
  const found = await stripe.products.search({ query: `metadata['booklo_plan']:'${plan}'`, limit: 1 });
  if (found.data[0]) {
    console.log(`product ${plan}: ${found.data[0].id} (exists)`);
    return found.data[0].id;
  }
  const product = await stripe.products.create({
    name: `Booklo ${PLANS[plan].name}`,
    description: PLANS[plan].blurb,
    tax_code: TAX_CODE,
    metadata: { booklo_plan: plan },
  });
  console.log(`product ${plan}: ${product.id} (created)`);
  return product.id;
}

/** `lookup_key` is unique per account+mode, so it is the idempotency key.
    A price's amount is immutable in Stripe: when the number in plans.ts
    moves, the old price is archived, gives up the lookup key and a new one
    takes it — and the OLD id must stay in the env map for as long as any
    subscription still bills on it (spec §7.12). */
async function findOrCreatePrice(stripe: Stripe, product: string, plan: PaidPlanId, interval: Interval): Promise<string> {
  const lookupKey = `booklo_${plan}_${interval}`;
  const amount = amountCents(plan, interval);
  const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0];
  if (existing) {
    if (existing.unit_amount === amount) {
      console.log(`price   ${lookupKey}: ${existing.id} (exists)`);
      return existing.id;
    }
    console.log(`price   ${lookupKey}: ${existing.id} is ${existing.unit_amount} ≠ ${amount} — rotating`);
    await stripe.prices.update(existing.id, { active: false, lookup_key: "" });
    console.log(`        KEEP ${existing.id} in the env map until nothing bills on it`);
  }
  const price = await stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    // Stripe Tax refuses a price whose behaviour is unspecified; USD list
    // prices are quoted net, the way B2B SaaS is sold.
    tax_behavior: "exclusive",
    // The second net for a rotated id: subscriptionFrom (lib/billing/stripe.ts)
    // falls back to this when the env map does not know the price.
    metadata: { plan, interval },
  });
  console.log(`price   ${lookupKey}: ${price.id} (created)`);
  return price.id;
}

/** 33.3 % off, forever. Stripe scopes a coupon to PRODUCTS, not prices, so
    this one covers Pro yearly too — startCheckout is what keeps it to Pro
    monthly (it only sends the code for plan=pro + interval=month). */
async function findOrCreateFounder(stripe: Stripe, proProduct: string): Promise<string> {
  const percentOff = Math.round((1 - FOUNDER_PRICE_FACTOR) * 1000) / 10;
  const coupons = await stripe.coupons.list({ limit: 100 });
  const coupon =
    coupons.data.find((c) => c.metadata?.booklo === "founder") ??
    (await stripe.coupons.create({
      name: "Founder",
      percent_off: percentOff,
      duration: "forever",
      applies_to: { products: [proProduct] },
      metadata: { booklo: "founder" },
    }));
  console.log(`coupon  founder: ${coupon.id} (${coupon.percent_off}% off, ${coupon.duration})`);

  const codes = await stripe.promotionCodes.list({ code: FOUNDER_CODE, limit: 1 });
  const promo =
    codes.data[0] ??
    (await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code: FOUNDER_CODE,
      max_redemptions: FOUNDER_MAX_REDEMPTIONS,
      metadata: { booklo: "founder" },
    }));
  console.log(`promo   ${FOUNDER_CODE}: ${promo.id} (${promo.times_redeemed}/${promo.max_redemptions ?? "∞"} used)`);
  return promo.id;
}

/** The portal IS the Pro↔Team path: startCheckout refuses a paid→paid move
    (`?error=use_portal`) so the change is a proration on the existing
    subscription instead of a second one. Both products must be listed here,
    or that refusal becomes a dead end. */
async function upsertPortal(stripe: Stripe, products: Array<{ product: string; prices: string[] }>): Promise<void> {
  const features = {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"] as Array<"price">,
      products,
      proration_behavior: "create_prorations" as const,
    },
    subscription_cancel: { enabled: true, mode: "at_period_end" as const },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: {
      enabled: true,
      allowed_updates: ["email", "address", "tax_id"] as Array<"email" | "address" | "tax_id">,
    },
  };
  const businessProfile = {
    privacy_policy_url: "https://booklo.co/privacy",
    terms_of_service_url: "https://booklo.co/terms",
  };
  const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = configs.data.find((c) => c.metadata?.booklo === "default");
  if (mine) {
    await stripe.billingPortal.configurations.update(mine.id, { features, business_profile: businessProfile });
    console.log(`portal  config: ${mine.id} (updated)`);
    return;
  }
  const created = await stripe.billingPortal.configurations.create({
    features,
    business_profile: businessProfile,
    default_return_url: "https://booklo.co/billing",
    metadata: { booklo: "default" },
  });
  console.log(`portal  config: ${created.id} (created, default for the account)`);
}

async function main(): Promise<void> {
  const key = requireKey();
  const stripe = new Stripe(key);
  console.log(`${live ? "LIVE" : "test"} mode\n`);

  const [proProduct, teamProduct] = await Promise.all([
    findOrCreateProduct(stripe, "pro"),
    findOrCreateProduct(stripe, "team"),
  ]);
  // Serial: two prices on the same product, and a rotation archives before
  // it creates — concurrency here only makes the log unreadable.
  const proMonth = await findOrCreatePrice(stripe, proProduct, "pro", "month");
  const proYear = await findOrCreatePrice(stripe, proProduct, "pro", "year");
  const teamMonth = await findOrCreatePrice(stripe, teamProduct, "team", "month");
  const teamYear = await findOrCreatePrice(stripe, teamProduct, "team", "year");
  const promoId = await findOrCreateFounder(stripe, proProduct);
  await upsertPortal(stripe, [
    { product: proProduct, prices: [proMonth, proYear] },
    { product: teamProduct, prices: [teamMonth, teamYear] },
  ]);

  console.log(`
${live ? "Vercel Production" : ".env.local"} — paste:

BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=${key.slice(0, 12)}…              (the key you ran this with)
STRIPE_WEBHOOK_SECRET=whsec_…                ${live ? "(the endpoint's signing secret)" : "(printed by `stripe listen`)"}
STRIPE_PRICE_PRO_MONTH=${proMonth}
STRIPE_PRICE_PRO_YEAR=${proYear}
STRIPE_PRICE_TEAM_MONTH=${teamMonth}
STRIPE_PRICE_TEAM_YEAR=${teamYear}
BILLING_FOUNDER_PROMO_CODE=${promoId}
BILLING_FOUNDER_CUTOFF=YYYY-MM-DD            (orgs created before this date get the Founder price)

Webhook: ${live ? "https://booklo.co/api/billing/webhook" : "stripe listen --forward-to localhost:3000/api/billing/webhook"}
Events:  customer.subscription.created, .updated, .deleted (invoice.* is ignored by design)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
