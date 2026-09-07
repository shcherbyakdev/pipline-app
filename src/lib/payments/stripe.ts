import "server-only";
import Stripe from "stripe";
import { env } from "@/env";
import type { AccountStatus, PaymentEvent, PaymentsProvider } from "./provider";

// Direct charges on Accounts v2 (spec rulings 1, 9; research §B):
// the studio is the merchant of record, pays Stripe's fees itself, Stripe
// carries losses; every money call carries { stripeAccount }.

const CHECKOUT_LOCALES = new Set(["pl", "en", "de", "cs", "sk", "lt", "lv", "et", "nl", "es", "it", "fr", "pt", "sv", "da", "fi", "nb"]);

export function normalizeConnectEvent(event: Stripe.Event): PaymentEvent | null {
  const map: Partial<Record<string, PaymentEvent["type"]>> = {
    "checkout.session.completed": "checkout.completed",
    "checkout.session.async_payment_succeeded": "checkout.async_succeeded",
    "checkout.session.async_payment_failed": "checkout.async_failed",
    "checkout.session.expired": "checkout.expired",
  };
  const type = map[event.type];
  if (!type) return null;
  const s = event.data.object as Stripe.Checkout.Session;
  const pi = s.payment_intent;
  return {
    type,
    sessionId: s.id,
    paymentIntentId: typeof pi === "string" ? pi : (pi?.id ?? null),
    amountCents: s.amount_total ?? null,
    paid: s.payment_status === "paid",
    accountId: event.account ?? null,
    eventId: event.id,
  };
}

function statusFrom(account: Stripe.V2.Core.Account): { status: AccountStatus; capabilities: Record<string, string> } {
  const caps = account.configuration?.merchant?.capabilities ?? {};
  const capabilities: Record<string, string> = {};
  for (const key of ["card_payments", "p24_payments", "blik_payments"] as const) {
    const c = (caps as Record<string, { status?: string } | undefined>)[key];
    if (c?.status) capabilities[key] = c.status;
  }
  const pastDue = account.requirements?.summary?.minimum_deadline?.status === "past_due";
  const cards = capabilities.card_payments;
  const status: AccountStatus = cards === "active" && !pastDue ? "active" : cards === "restricted" || pastDue ? "restricted" : "onboarding";
  return { status, capabilities };
}

export function stripePaymentsProvider(): PaymentsProvider {
  if (!env.STRIPE_CONNECT_SECRET_KEY) throw new Error("STRIPE_CONNECT_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_CONNECT_SECRET_KEY);
  return {
    name: "stripe",
    async createAccount(input) {
      const account = await stripe.v2.core.accounts.create({
        display_name: input.displayName,
        contact_email: input.email,
        dashboard: "full",
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        identity: { country: input.country.toLowerCase() },
        configuration: {
          merchant: {
            mcc: "7333", // D1 §4: commercial photography; never a rental MCC (6513 is prohibited for P24)
            capabilities: {
              card_payments: { requested: true },
              p24_payments: { requested: true },
              blik_payments: { requested: true },
            },
          },
        },
      });
      return { accountId: account.id };
    },
    async createOnboardingLink(accountId, returnUrl, refreshUrl) {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], return_url: returnUrl, refresh_url: refreshUrl } },
      });
      return link.url;
    },
    async getAccountStatus(accountId) {
      const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
      return statusFrom(account);
    },
    async createCheckout(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountCents, product_data: { name: input.productName } } }],
          customer_email: input.customerEmail,
          expires_at: input.expiresAt,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          locale: (input.locale && CHECKOUT_LOCALES.has(input.locale) ? input.locale : "auto") as Stripe.Checkout.SessionCreateParams.Locale,
          metadata: { booking_id: input.bookingId, payment_id: input.paymentId },
          payment_intent_data: { metadata: { booking_id: input.bookingId, payment_id: input.paymentId } },
          // No payment_method_types: the connected account's own dynamic
          // methods (P24 / BLIK / cards) apply.
        },
        { stripeAccount: input.accountId, idempotencyKey: input.paymentId },
      );
      if (!session.url) throw new Error("stripe: no checkout url");
      return { sessionId: session.id, url: session.url };
    },
    async expireCheckout(accountId, sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId });
      } catch (error) {
        // Already expired or completed: nothing to do. Anything else is logged, never thrown.
        console.warn("[payments] expireCheckout:", error instanceof Error ? error.message : error);
      }
    },
    async refund(accountId, paymentIntentId, amountCents, idempotencyKey) {
      const r = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents }, { stripeAccount: accountId, idempotencyKey });
      return { refundId: r.id };
    },
    parseWebhook(rawBody, headers) {
      if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) throw new Error("STRIPE_CONNECT_WEBHOOK_SECRET unset");
      const sig = headers.get("stripe-signature") ?? "";
      const event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_CONNECT_WEBHOOK_SECRET); // throws on bad signature
      const normalized = normalizeConnectEvent(event);
      return normalized ? [normalized] : [];
    },
  };
}
