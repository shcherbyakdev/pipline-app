import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import type { BillingEvent, BillingProvider, CheckoutInput, CheckoutSession } from "./provider";

export function signFakeWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Body = JSON array of BillingEvent minus `provider`/`raw`. */
export function parseFakeWebhook(rawBody: string, headers: Headers, secret: string): BillingEvent[] {
  const provided = headers.get("x-signature") ?? "";
  const expected = signFakeWebhook(rawBody, secret);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
  const parsed = JSON.parse(rawBody) as Array<Omit<BillingEvent, "provider" | "raw">>;
  return parsed.map((e) => ({ ...e, provider: "fake", raw: e }));
}

export function fakeProvider(): BillingProvider {
  return {
    name: "fake",
    async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
      // `cancel` rides along the way Stripe's session carries cancel_url; the
      // checkout page origin-checks it before rendering it as a link.
      const q = new URLSearchParams({
        org: input.orgId, plan: input.plan, interval: input.interval, return: input.returnUrl, cancel: input.cancelUrl,
      });
      if (input.providerCustomerId) q.set("customer", input.providerCustomerId);
      // The emulator has no promotion codes to run out of, so the Founder
      // fallback never happens here (the checkout page prices the discount
      // itself from isFounderEligible).
      return { url: `${env.NEXT_PUBLIC_APP_URL}/dev/billing/checkout?${q}`, founderFallback: false };
    },
    async createPortalUrl(_customerId: string, returnUrl: string) {
      const q = new URLSearchParams({ return: returnUrl });
      return `${env.NEXT_PUBLIC_APP_URL}/dev/billing/portal?${q}`;
    },
    parseWebhook(rawBody, headers) {
      if (!env.BILLING_FAKE_SECRET) throw new Error("BILLING_FAKE_SECRET unset");
      return parseFakeWebhook(rawBody, headers, env.BILLING_FAKE_SECRET);
    },
  };
}
