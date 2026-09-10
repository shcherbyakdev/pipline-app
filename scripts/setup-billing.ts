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
 * Assumes the account's ladder is this script's to own: it adopts nothing
 * built by hand in the dashboard (a hand-made price has no `lookup_key`, so
 * the script would build a second one beside it). Booklo's test and live
 * accounts were both created empty; if that ever stops being true, give the
 * hand-made prices the `booklo_<plan>_<interval>` lookup keys first.
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

/** Live money is one flag away from test money: say it out loud, both ways.
    Matched on `_live_`, not on the `sk_` prefix — a restricted key
    (`rk_live_…`) is live money too, and would otherwise sail through the
    guard and build the real ladder while the log says "test mode". */
function requireKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY unset (test mode: sk_test_… from Developers → API keys)");
  const isLiveKey = key.includes("_live_");
  if (isLiveKey && !live) throw new Error("that is a LIVE key — re-run with --live if you mean it");
  if (!isLiveKey && live) throw new Error("--live passed with a test key");
  return key;
}

const amountCents = (plan: PaidPlanId, interval: Interval) =>
  Math.round((interval === "month" ? PLANS[plan].monthly : PLANS[plan].yearly) * 100);

/** The product id is OURS, not Stripe's: `products.search` is index-backed
    and hides anything created in the last minute, so two quick runs would
    each decide there was no product and make a second one. A deterministic
    id turns "find or create" into a retrieve. */
async function findOrCreateProduct(stripe: Stripe, plan: PaidPlanId): Promise<string> {
  const id = `booklo_${plan}`;
  try {
    const existing = await stripe.products.retrieve(id);
    console.log(`product ${plan}: ${existing.id} (exists)`);
    return existing.id;
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.statusCode !== 404) throw error;
  }
  // An account set up before this script used deterministic ids still has a
  // tagged product with a generated one. Adopt it — creating a twin would
  // leave the prices on the old product and the portal config pointing at
  // the new one, which Stripe refuses. `list`, not `search`: no index lag.
  for await (const candidate of stripe.products.list({ limit: 100 })) {
    if (candidate.metadata?.booklo_plan === plan) {
      console.log(`product ${plan}: ${candidate.id} (adopted)`);
      return candidate.id;
    }
  }
  const product = await stripe.products.create({
    id,
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
    moves, a new price claims the key (`transfer_lookup_key`, one atomic
    call) and the old one is archived. Subscriptions bought at the old price
    keep billing on it and keep emitting webhooks under its id — what makes
    those projectable is the `plan`/`interval` metadata below, not the env
    map, which has exactly four slots and no room for a fifth id. */
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
  }
  const price = await stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    // Takes the key off the old price in the same call, so there is never a
    // moment when the key belongs to nothing.
    transfer_lookup_key: Boolean(existing),
    // Stripe Tax refuses a price whose behaviour is unspecified; USD list
    // prices are quoted net, the way B2B SaaS is sold.
    tax_behavior: "exclusive",
    // The second net for a rotated id: subscriptionFrom (lib/billing/stripe.ts)
    // falls back to this when the env map does not know the price.
    metadata: { plan, interval },
  });
  if (existing) {
    await stripe.prices.update(existing.id, { active: false });
    console.log(`        archived ${existing.id}; subscriptions on it still project via its metadata`);
  }
  console.log(`price   ${lookupKey}: ${price.id} (created)`);
  return price.id;
}

/** 33.3 % off, forever. Stripe scopes a coupon to PRODUCTS, not prices, so
    this one covers Pro yearly too — startCheckout is what keeps it to Pro
    monthly (it only sends the code for plan=pro + interval=month). */
async function findOrCreateFounder(stripe: Stripe, proProduct: string): Promise<string> {
  const percentOff = Math.round((1 - FOUNDER_PRICE_FACTOR) * 1000) / 10;
  let coupon: Stripe.Coupon | undefined;
  // Auto-paginated: a coupon has no lookup key to search by, and `list`
  // stops at 100 on an account that has been around.
  for await (const c of stripe.coupons.list({ limit: 100 })) {
    if (c.metadata?.booklo === "founder") { coupon = c; break; }
  }
  // `percent_off` is immutable. Reusing a coupon whose discount no longer
  // matches FOUNDER_PRICE_FACTOR would leave the pricing page, the ribbon
  // and the marketing copy quoting one number while Stripe charges another,
  // and nothing would say so — hence a refusal rather than a warning.
  if (coupon && coupon.percent_off !== percentOff) {
    throw new Error(
      `coupon ${coupon.id} is ${coupon.percent_off}% off but plans.ts now says ${percentOff}%. ` +
        "percent_off cannot be edited: archive that coupon and its FOUNDER code in the dashboard, then re-run.",
    );
  }
  coupon ??= await stripe.coupons.create({
    name: "Founder",
    percent_off: percentOff,
    duration: "forever",
    applies_to: { products: [proProduct] },
    metadata: { booklo: "founder" },
  });
  console.log(`coupon  founder: ${coupon.id} (${coupon.percent_off}% off, ${coupon.duration})`);

  const existing = (await stripe.promotionCodes.list({ code: FOUNDER_CODE, limit: 1 })).data[0];
  // A code by that name pointing somewhere else is not ours: printing its id
  // as BILLING_FOUNDER_PROMO_CODE would apply a discount nobody chose (or
  // none at all) while the coupon just made sits unused.
  const pointsAt = existing && (typeof existing.promotion.coupon === "string" ? existing.promotion.coupon : existing.promotion.coupon?.id);
  if (existing && pointsAt !== coupon.id) {
    throw new Error(`promotion code ${FOUNDER_CODE} (${existing.id}) points at coupon ${pointsAt}, not ${coupon.id}`);
  }
  const promo =
    existing ??
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
