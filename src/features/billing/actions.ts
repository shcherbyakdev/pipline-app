"use server";

import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { selectBillingProvider } from "@/lib/billing/provider";
import { getOrgSubscription } from "@/lib/billing/queries";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { isPaidPlan } from "@/lib/billing/plans";
import { BILLING_ENABLED } from "@/lib/flags";
import { isFounderEligible } from "./founder";
import { checkoutInput } from "./schema";

/** The Founder promotion code when this org qualifies (isFounderEligible) —
    undefined whenever the env pair is unset, which is every environment until
    the promo is configured, and the reason the org read is skipped there. */
async function founderCodeFor(orgId: string): Promise<string | undefined> {
  if (!env.BILLING_FOUNDER_PROMO_CODE) return undefined;
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("created_at").eq("id", orgId).maybeSingle();
  return isFounderEligible(data?.created_at) ? env.BILLING_FOUNDER_PROMO_CODE : undefined;
}

/* Provider calls are network I/O against a third party: a failure must land
   the member back on /billing with a line they can act on, never a stack
   trace. redirect() throws a Next control-flow error, so it stays OUT of the
   try — hence a helper that returns null instead of one wrapped in a catch. */
async function providerUrl(make: () => Promise<string>, label: string): Promise<string | null> {
  try {
    return await make();
  } catch (error) {
    console.error(`[billing] ${label}:`, error);
    return null;
  }
}

/** The org's subscription row for the duplicate-purchase guard, with "no row"
    (Free — may buy) kept distinct from "couldn't read" (unknown — must not).
    getOrgSubscription throws, and a thrown Server Action would show an error
    boundary instead of this page's `?error=` line. */
async function readSubscription(orgId: string, supabase: SupabaseClient) {
  try {
    return { ok: true as const, sub: await getOrgSubscription(orgId, supabase) };
  } catch (error) {
    console.error("[billing] startCheckout subscription read:", error);
    return { ok: false as const, sub: null };
  }
}

/** Form action: hidden `plan` + `interval` inputs → the provider's checkout. */
export async function startCheckout(formData: FormData): Promise<void> {
  // The page 404s while the flag is off, so a POST that gets here is
  // hand-crafted; answer it the same way the route does.
  if (!BILLING_ENABLED) notFound();
  const parsed = checkoutInput.safeParse({
    plan: formData.get("plan"),
    interval: formData.get("interval"),
  });
  if (!parsed.success) redirect("/billing?error=checkout");
  const { user, org } = await requireOrg();
  const supabase = await createClient();
  const current = await readSubscription(org.id, supabase);
  // "Couldn't read" must never pass for "Free": that is precisely how a
  // paying org would end up buying a second subscription (§7.10 — refuse
  // conservatively).
  if (!current.ok) redirect("/billing?error=checkout");
  // An org that already HAS an effective paid plan never buys a second one:
  // Pro→Team and Team→Pro are both a proration on the existing subscription,
  // which only the portal can do. Checkout here would create a duplicate
  // subscription (and, without the customer id below, a duplicate customer).
  // The picker already renders the portal link for this case — this is the
  // server-side twin of that rule.
  if (isPaidPlan(entitlementsFor(current.sub, new Date()).plan)) redirect("/billing?error=use_portal");
  // A row that exists but no longer entitles (expired, or a cancelled period
  // that ran out) is a RESUBSCRIBE: the org already has a provider customer,
  // so hand it over rather than let checkout mint a second one and split the
  // org's payment history across two customers. Same read as openPortal's.
  let providerCustomerId: string | undefined;
  if (current.sub) {
    const { data, error } = await supabase
      .from("org_subscriptions")
      .select("provider_customer_id")
      .eq("org_id", org.id)
      .maybeSingle();
    if (error || !data?.provider_customer_id) {
      console.error("[billing] startCheckout customer read:", error);
      redirect("/billing?error=checkout");
    }
    providerCustomerId = data.provider_customer_id;
  }
  // The Founder coupon is 33.3 % off Pro MONTHLY, forever (spec §3): sending
  // it with any other plan/interval asks Stripe to apply a coupon that does
  // not cover the price, which it rejects — and the sale with it.
  const discountCode =
    parsed.data.plan === "pro" && parsed.data.interval === "month"
      ? await founderCodeFor(org.id)
      : undefined;
  const url = await providerUrl(
    () =>
      selectBillingProvider().createCheckoutUrl({
        orgId: org.id,
        plan: parsed.data.plan,
        interval: parsed.data.interval,
        email: user.email ?? "",
        discountCode,
        providerCustomerId,
        // `plan` rides along so the return page knows WHICH plan to wait
        // for: the activation poller compares the freshly-read plan against
        // it, and `checkout=success` alone couldn't tell Pro from Team.
        returnUrl: `${env.NEXT_PUBLIC_APP_URL}/billing?checkout=success&plan=${parsed.data.plan}`,
      }),
    "startCheckout",
  );
  if (!url) redirect("/billing?error=checkout");
  redirect(url);
}

/** Form action: the provider's portal, where cards, invoices, downgrades and
    cancellations live — we build none of those screens (spec §7.6). */
export async function openPortal(): Promise<void> {
  if (!BILLING_ENABLED) notFound();
  const { org } = await requireOrg();
  const supabase = await createClient();
  // The row itself is the ticket: provider_customer_id is NOT NULL (0042),
  // and a cancelled or expired org still belongs in the portal (invoices,
  // resubscribe), so this asks for the row rather than for an active plan.
  const { data } = await supabase
    .from("org_subscriptions")
    .select("provider_customer_id")
    .eq("org_id", org.id)
    .maybeSingle();
  if (!data?.provider_customer_id) redirect("/billing?error=portal");
  const url = await providerUrl(
    () =>
      selectBillingProvider().createPortalUrl(
        data.provider_customer_id,
        `${env.NEXT_PUBLIC_APP_URL}/billing`,
      ),
    "openPortal",
  );
  if (!url) redirect("/billing?error=portal_unavailable");
  redirect(url);
}
