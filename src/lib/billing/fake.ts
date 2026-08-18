import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import type { BillingEvent, BillingProvider, CheckoutInput } from "./provider";

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
    async createCheckoutUrl(input: CheckoutInput) {
      const q = new URLSearchParams({ org: input.orgId, plan: input.plan, interval: input.interval, return: input.returnUrl });
      return `${env.NEXT_PUBLIC_APP_URL}/api/billing/dev-checkout?${q}`;
    },
    async createPortalUrl(_customerId: string, returnUrl: string) {
      return returnUrl; // nothing to manage in the fake
    },
    parseWebhook(rawBody, headers) {
      if (!env.BILLING_FAKE_SECRET) throw new Error("BILLING_FAKE_SECRET unset");
      return parseFakeWebhook(rawBody, headers, env.BILLING_FAKE_SECRET);
    },
  };
}
