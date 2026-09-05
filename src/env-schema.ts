import { z } from "zod";

// Validated environment. NEXT_PUBLIC_* vars are referenced literally so
// Next.js can inline them into the client bundle at build time.
//
// Real Supabase credentials now exist, so the public Supabase vars are
// required. Server-only vars stay optional for now — not every environment
// needs the service role key or a direct database URL.
export const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  // Production marker. NOT NODE_ENV: that is "production" inside every
  // `next build`, including CI's, which supplies placeholder values. Set
  // only in the Vercel project, so it is present during `vercel build`
  // and absent in CI — which is exactly the discrimination we need.
  APP_ENV: z.enum(["development", "production"]).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  CHASE_DRAIN_SECRET: z.string().min(16).optional(),
  SCHEDULING_DRAIN_SECRET: z.string().min(16).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  BILLING_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  BILLING_FAKE_SECRET: z.string().min(16).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_MONTH: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_YEAR: z.string().min(1).optional(),
  STRIPE_PRICE_TEAM_MONTH: z.string().min(1).optional(),
  STRIPE_PRICE_TEAM_YEAR: z.string().min(1).optional(),
  BILLING_FOUNDER_PROMO_CODE: z.string().min(1).optional(),
  BILLING_FOUNDER_CUTOFF: z.string().date().optional(),
  // Comma-separated emails allowed into /utils (owner-only back office). Unset = nobody.
  INTERNAL_EMAILS: z.string().optional(),
  // Web Push (spec 2026-09-05). All three or none: the page shows push as
  // "not set up" and the seam skips it when absent — unlike the email
  // transport this never throws, an optional channel must not break a
  // booking. Generate once: `npx web-push generate-vapid-keys`. The subject
  // is a mailto: or https: URL the push services may contact about abuse.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "VAPID_SUBJECT must be a mailto: or https: URL").optional(),
  // Google Calendar (spec 2026-09-05). All three or none, VAPID idiom: the
  // page says "not set up", the OAuth routes 404, sync and busy reads are
  // skipped. The key seals the stored Google tokens (AES-256-GCM,
  // lib/google/crypto.ts): 32 random bytes, base64 — `openssl rand -base64 32`.
  // Rotating it orphans every connection (they show as needing a reconnect).
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GCAL_TOKEN_KEY: z.string().min(1).optional(),
  // Local QA only: point the OAuth and API clients at a fake Google
  // (scripts/fake-google.mjs). Refused in production below.
  // Search Console meta-tag token: Google pushes calendar notifications only
  // to a verified domain (v2 decision 20). Absent → poll every tick instead.
  GOOGLE_SITE_VERIFICATION: z.string().min(1).optional(),
  GOOGLE_OAUTH_BASE: z.string().url().optional(),
  GOOGLE_API_BASE: z.string().url().optional(),
}).superRefine((value, ctx) => {
  if (value.APP_ENV !== "production") return;

  for (const key of ["GOOGLE_OAUTH_BASE", "GOOGLE_API_BASE"] as const) {
    if (value[key]) {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} must not be set when APP_ENV=production (local fake only)` });
    }
  }

  // Everything below is optional in the base schema because local
  // development legitimately runs without it. In production each one is
  // load-bearing, and the failure mode of a missing value is silent:
  // NEXT_PUBLIC_APP_URL in particular defaults to localhost and would put
  // localhost links in every email the product sends.
  const required = [
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SCHEDULING_DRAIN_SECRET",
    "INTERNAL_EMAILS",
  ] as const;

  for (const key of required) {
    if (!value[key]) {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when APP_ENV=production` });
    }
  }

  if (/localhost|127\.0\.0\.1/.test(value.NEXT_PUBLIC_APP_URL)) {
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "NEXT_PUBLIC_APP_URL must not be localhost when APP_ENV=production",
    });
  }

  // Billing provider selection is env-only (selectBillingProvider): anything
  // other than "stripe" falls back to the fake emulator, whose webhook accepts
  // self-signed events — it verifies only an HMAC over the body with
  // BILLING_FAKE_SECRET and then trusts orgId/plan/status verbatim, granting
  // any org a paid plan via the service-role client. That secret is a dev-only
  // artifact and must never exist in production; forbidding it here fails the
  // deploy closed rather than leaving the fake webhook live. (The dev checkout
  // UI is separately dead in prod behind requireDevBilling's APP_ENV gate.)
  if (value.BILLING_FAKE_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["BILLING_FAKE_SECRET"],
      message: "BILLING_FAKE_SECRET must not be set when APP_ENV=production (dev emulator only)",
    });
  }

  // When Stripe billing is actually live, fail closed at boot if it is
  // half-configured, instead of 503-ing on the first webhook or checkout.
  // The four price ids are as load-bearing as the secrets: a missing one
  // throws on the first checkout of that plan (stripe.ts#priceIdFor), and —
  // worse — leaves that price out of the webhook's price map, so every
  // subscription on it arrives as "unmapped" and is refused until the id is
  // set (stripe.ts#normalizeStripeEvent).
  if (value.BILLING_PROVIDER === "stripe") {
    const stripeKeys = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_PRO_MONTH",
      "STRIPE_PRICE_PRO_YEAR",
      "STRIPE_PRICE_TEAM_MONTH",
      "STRIPE_PRICE_TEAM_YEAR",
    ] as const;
    for (const key of stripeKeys) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when BILLING_PROVIDER=stripe`,
        });
      }
    }
  }
});
