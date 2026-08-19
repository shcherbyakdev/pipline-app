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
}).superRefine((value, ctx) => {
  if (value.APP_ENV !== "production") return;

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
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_ENV: process.env.APP_ENV,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  CHASE_DRAIN_SECRET: process.env.CHASE_DRAIN_SECRET,
  SCHEDULING_DRAIN_SECRET: process.env.SCHEDULING_DRAIN_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  BILLING_PROVIDER: process.env.BILLING_PROVIDER,
  BILLING_FAKE_SECRET: process.env.BILLING_FAKE_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_PRO_MONTH: process.env.STRIPE_PRICE_PRO_MONTH,
  STRIPE_PRICE_PRO_YEAR: process.env.STRIPE_PRICE_PRO_YEAR,
  STRIPE_PRICE_TEAM_MONTH: process.env.STRIPE_PRICE_TEAM_MONTH,
  STRIPE_PRICE_TEAM_YEAR: process.env.STRIPE_PRICE_TEAM_YEAR,
  BILLING_FOUNDER_PROMO_CODE: process.env.BILLING_FOUNDER_PROMO_CODE,
  BILLING_FOUNDER_CUTOFF: process.env.BILLING_FOUNDER_CUTOFF,
  INTERNAL_EMAILS: process.env.INTERNAL_EMAILS,
});
