import "server-only";
import { env } from "@/env";
import { stripePaymentsProvider } from "./stripe";
import { fakePaymentsProvider } from "./fake";

// S2: the vendor seam for client money (spec §Provider seam). Sibling of
// lib/billing/provider.ts, deliberately not the same interface — billing is
// subscription-shaped, this is "one deposit on the studio's own account".

export type AccountStatus = "onboarding" | "active" | "restricted";

export type CheckoutInput = {
  accountId: string;
  amountCents: number;
  currency: string;
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds, already clamped by checkoutExpiresAt. */
  expiresAt: number;
  locale: string | null;
  bookingId: string;
  paymentId: string;
};

export type PaymentEvent = {
  type: "checkout.completed" | "checkout.async_succeeded" | "checkout.async_failed" | "checkout.expired";
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number | null;
  /** completed only: false while an async method (P24) is still settling. */
  paid: boolean;
  accountId: string | null;
  eventId: string;
};

export interface PaymentsProvider {
  readonly name: "stripe" | "fake";
  createAccount(input: { country: string; email: string; displayName: string }): Promise<{ accountId: string }>;
  createOnboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  getAccountStatus(accountId: string): Promise<{ status: AccountStatus; capabilities: Record<string, string> }>;
  createCheckout(input: CheckoutInput): Promise<{ sessionId: string; url: string }>;
  /** Best effort; an already-expired/completed session is not an error. */
  expireCheckout(accountId: string, sessionId: string): Promise<void>;
  refund(accountId: string, paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ refundId: string }>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[];
}

export function paymentsConfigured(): boolean {
  if (env.PAYMENTS_PROVIDER === "stripe") return Boolean(env.STRIPE_CONNECT_SECRET_KEY && env.STRIPE_CONNECT_WEBHOOK_SECRET);
  if (env.PAYMENTS_PROVIDER === "fake") return Boolean(env.PAYMENTS_FAKE_SECRET);
  return false;
}

export function selectPaymentsProvider(): PaymentsProvider {
  if (env.PAYMENTS_PROVIDER === "stripe") return stripePaymentsProvider();
  if (env.PAYMENTS_PROVIDER === "fake") return fakePaymentsProvider();
  throw new Error("payments not configured");
}

const MIN_AHEAD_S = 30 * 60 + 30; // Stripe: expires_at ≥ 30 min after creation; +30 s of slack
const MAX_AHEAD_S = 24 * 3600;

/** Checkout expires when the hold does, inside Stripe's [30 min, 24 h] window. */
export function checkoutExpiresAt(holdExpiresAt: Date, now: Date = new Date()): number {
  const nowS = Math.floor(now.getTime() / 1000);
  const holdS = Math.floor(holdExpiresAt.getTime() / 1000);
  return Math.min(Math.max(holdS, nowS + MIN_AHEAD_S), nowS + MAX_AHEAD_S);
}
