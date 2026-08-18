"use server";

import { notFound, redirect } from "next/navigation";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { selectBillingProvider } from "@/lib/billing/provider";
import { BILLING_ENABLED } from "@/lib/flags";
import { checkoutInput } from "./schema";

/** The Founder promotion code when this org was created before the cutoff
    (spec §3) — undefined whenever the env pair is unset, which is every
    environment until the promo is configured. */
async function founderCodeFor(orgId: string): Promise<string | undefined> {
  if (!env.BILLING_FOUNDER_PROMO_CODE || !env.BILLING_FOUNDER_CUTOFF) return undefined;
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("created_at").eq("id", orgId).maybeSingle();
  if (!data?.created_at) return undefined;
  return Date.parse(data.created_at) < Date.parse(`${env.BILLING_FOUNDER_CUTOFF}T00:00:00Z`)
    ? env.BILLING_FOUNDER_PROMO_CODE
    : undefined;
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
  const discountCode = await founderCodeFor(org.id);
  const url = await providerUrl(
    () =>
      selectBillingProvider().createCheckoutUrl({
        orgId: org.id,
        plan: parsed.data.plan,
        interval: parsed.data.interval,
        email: user.email ?? "",
        discountCode,
        returnUrl: `${env.NEXT_PUBLIC_APP_URL}/billing?checkout=success`,
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
  if (!url) redirect("/billing?error=checkout");
  redirect(url);
}
