import { NextResponse } from "next/server";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyBillingEvents } from "@/lib/billing/apply-events";
import { isPaidPlan, TEAM_INCLUDED_SEATS } from "@/lib/billing/plans";

// Fake provider's "checkout": writes an active subscription and bounces back.
// Dev/test only — 404 in production or whenever the real provider is on.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || env.BILLING_PROVIDER === "stripe") {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  const plan = url.searchParams.get("plan");
  const interval = url.searchParams.get("interval") === "year" ? "year" : "month";
  const back = url.searchParams.get("return") ?? `${env.NEXT_PUBLIC_APP_URL}/billing`;
  if (!org || !plan || !isPaidPlan(plan)) return Response.json({ error: "bad params" }, { status: 400 });
  const now = new Date();
  await applyBillingEvents(createAdminClient(), [{
    provider: "fake", providerEventId: `dev-${org}-${now.getTime()}`, occurredAt: now.toISOString(), orgId: org,
    type: "subscription_created", raw: { dev: true },
    subscription: {
      providerCustomerId: `cus_dev_${org}`, providerSubscriptionId: `sub_dev_${org}`, plan, interval,
      seats: plan === "team" ? TEAM_INCLUDED_SEATS : 1, status: "active",
      currentPeriodEnd: new Date(now.getTime() + 30 * 864e5).toISOString(), cancelAtPeriodEnd: false,
    },
  }]);
  // `new URL(back, request.url)`, not a template string: `back` may be a
  // relative path (`return=/billing`) — a bare Response.redirect() throws
  // on those (auth/confirm/route.ts idiom). `.set`, not string
  // concatenation, so a `return` that already carries `checkout=success`
  // doesn't end up with the param twice.
  const target = new URL(back, request.url);
  target.searchParams.set("checkout", "success");
  return NextResponse.redirect(target, 303);
}
