import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import type { PaymentEvent, PaymentsProvider } from "./provider";

// Mirrors lib/billing/fake.ts: HMAC over the body, events trusted verbatim.
// Dev/CI only — env-schema forbids it in production.

export function signFakePaymentsWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Body = JSON array of PaymentEvent minus `eventId` (one is minted here). */
export function parseFakePaymentsWebhook(rawBody: string, headers: Headers, secret: string): PaymentEvent[] {
  const provided = headers.get("x-signature") ?? "";
  const expected = signFakePaymentsWebhook(rawBody, secret);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
  const parsed = JSON.parse(rawBody) as Array<Omit<PaymentEvent, "eventId">>;
  return parsed.map((e) => ({ ...e, eventId: `evt_fake_${randomBytes(6).toString("hex")}` }));
}

export function fakePaymentsProvider(): PaymentsProvider {
  return {
    name: "fake",
    async createAccount(input) {
      return { accountId: `acct_fake_${input.country.toLowerCase()}_${randomBytes(6).toString("hex")}` };
    },
    // Instant onboarding: the link IS the return URL.
    async createOnboardingLink(_accountId, returnUrl) {
      return returnUrl;
    },
    async getAccountStatus() {
      return { status: "active", capabilities: { card_payments: "active", p24_payments: "active", blik_payments: "active" } };
    },
    async createCheckout(input) {
      const sessionId = `cs_fake_${randomBytes(8).toString("hex")}`;
      const q = new URLSearchParams({ session: sessionId, payment: input.paymentId, return: input.successUrl, cancel: input.cancelUrl });
      return { sessionId, url: `${env.NEXT_PUBLIC_APP_URL}/dev/payments/checkout?${q}` };
    },
    async expireCheckout() {},
    async refund() {
      return { refundId: `re_fake_${randomBytes(6).toString("hex")}` };
    },
    parseWebhook(rawBody, headers) {
      if (!env.PAYMENTS_FAKE_SECRET) throw new Error("PAYMENTS_FAKE_SECRET unset");
      return parseFakePaymentsWebhook(rawBody, headers, env.PAYMENTS_FAKE_SECRET);
    },
  };
}
