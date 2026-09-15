"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyBillingEvents } from "@/lib/billing/apply-events";
import { selectBillingProvider, type SubscriptionChange, type SwitchChange } from "@/lib/billing/provider";
import { getPlanOverride, getProviderSubscription, getRawOrgSubscription } from "@/lib/billing/queries";
import { isOverrideActive } from "@/lib/billing/overrides";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { isPaidPlan, switchBilling, type SwitchBilling } from "@/lib/billing/plans";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { isFounderEligible } from "./founder";
import { checkoutInput, planChangeInput } from "./schema";

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
async function providerCall<T>(make: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await make();
  } catch (error) {
    console.error(`[billing] ${label}:`, error);
    return null;
  }
}

/** The org's subscription row for the duplicate-purchase guard, with "no row"
    (Free — may buy) kept distinct from "couldn't read" (unknown — must not).
    getRawOrgSubscription throws, and a thrown Server Action would show an
    error boundary instead of this page's `?error=` line.

    RAW, not effective: a comped org has no provider subscription to prorate,
    so it may still buy one — the comp simply keeps winning until it lapses. */
async function readSubscription(orgId: string, supabase: SupabaseClient) {
  try {
    return { ok: true as const, sub: await getRawOrgSubscription(orgId, supabase) };
  } catch (error) {
    console.error("[billing] startCheckout subscription read:", error);
    return { ok: false as const, sub: null };
  }
}

/** The org's comp override for the "nothing to buy" guard — same
    "couldn't read ⇒ refuse" shape as readSubscription above, and for the same
    reason: a read we could not make must never pass for "no comp". */
async function readOverride(orgId: string, supabase: SupabaseClient) {
  try {
    return { ok: true as const, override: await getPlanOverride(orgId, supabase) };
  } catch (error) {
    console.error("[billing] startCheckout override read:", error);
    return { ok: false as const, override: null };
  }
}

/** Form action: hidden `plan` + `interval` inputs → the provider's checkout. */
export async function startCheckout(formData: FormData): Promise<void> {
  const { user, org } = await requireOrg();
  // The page 404s while the org's flag is off, so a POST that gets here is
  // hand-crafted; answer it the same way the route does.
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  const parsed = checkoutInput.safeParse({
    plan: formData.get("plan"),
    interval: formData.get("interval"),
    // FormData says null for an absent field; zod's optional wants undefined.
    founder: formData.get("founder") ?? undefined,
  });
  if (!parsed.success) redirect("/billing?error=checkout");
  const supabase = await createClient();
  // A comped org has nothing to buy. An unexpired override wins outright at
  // the seam (lib/billing/queries.ts#getOrgSubscription), so letting checkout
  // through would charge a card for a subscription the entitlements ignore,
  // and the return page's activation poller would spin forever waiting for an
  // effective plan that never moves. The page hides the picker for the same
  // reason — this is its server-side twin.
  const comp = await readOverride(org.id, supabase);
  if (!comp.ok) redirect("/billing?error=checkout");
  if (isOverrideActive(comp.override, new Date())) redirect("/billing?error=complimentary");
  const current = await readSubscription(org.id, supabase);
  // "Couldn't read" must never pass for "Free": that is precisely how a
  // paying org would end up buying a second subscription (§7.10 — refuse
  // conservatively).
  if (!current.ok) redirect("/billing?error=checkout");
  // An org that already HAS an effective paid plan never buys a second one:
  // Pro→Team and Team→Pro are both a proration on the existing subscription,
  // which `changePlan` below does. Checkout here would create a duplicate
  // subscription (and, without the customer id below, a duplicate customer).
  // The picker renders a switch button for this case — this is the
  // server-side twin of that rule.
  if (isPaidPlan(entitlementsFor(current.sub, new Date()).plan)) redirect("/billing?error=change_here");
  // A row that exists but no longer entitles (expired, or a cancelled period
  // that ran out) is a RESUBSCRIBE: the org already has a provider customer,
  // so hand it over rather than let checkout mint a second one and split the
  // org's payment history across two customers. Same read as updatePaymentMethod's.
  let providerCustomerId: string | undefined;
  if (current.sub) {
    const { data, error } = await supabase
      .from("org_subscriptions")
      .select("provider_customer_id, provider")
      .eq("org_id", org.id)
      .maybeSingle();
    if (error || !data?.provider_customer_id) {
      console.error("[billing] startCheckout customer read:", error);
      redirect("/billing?error=checkout");
    }
    // Only a customer THIS provider minted is worth handing over: a row the
    // fake emulator wrote (a dev database pointed at Stripe, or the other
    // way round) carries an id Stripe has never seen, and the session would
    // be refused. Let the provider create a fresh customer instead — the
    // webhook overwrites the row with the real one (updatePaymentMethod's twin).
    providerCustomerId = data.provider === env.BILLING_PROVIDER ? data.provider_customer_id : undefined;
  }
  // The Founder coupon is 33.3 % off Pro MONTHLY, forever (spec §3): sending
  // it with any other plan/interval asks Stripe to apply a coupon that does
  // not cover the price, which it rejects — and the sale with it. `founder=
  // skip` is the retry after `?error=founder_ended` (checkoutInput).
  const discountCode =
    parsed.data.plan === "pro" && parsed.data.interval === "month" && parsed.data.founder !== "skip"
      ? await founderCodeFor(org.id)
      : undefined;
  const session = await providerCall(
    () =>
      selectBillingProvider().createCheckout({
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
        // Its own URL, WITHOUT the success markers: "back" from a hosted
        // checkout is not a purchase, and /billing must not poll for one.
        cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/billing?checkout=cancelled`,
      }),
    "startCheckout",
  );
  if (!session) redirect("/billing?error=checkout");
  // The provider refused the Founder code and built the session at list
  // price instead. The member was shown the Founder number, so sending them
  // on would have them pay more than the page promised: stop, say the offer
  // has ended, and let them buy again at the price now shown.
  if (session.founderFallback) redirect("/billing?error=founder_ended");
  redirect(session.url);
}

/** Form action: the provider's hosted card form, deep-linked.

    The ONE screen we still hand over. Managed Payments doesn't support
    Elements ("embeddable web components or other advanced integrations"),
    so a card field of our own isn't allowed to exist; everything else the
    portal used to do — cancel, resume, plan and interval switches — is
    below, in our own pages. */
export async function updatePaymentMethod(): Promise<void> {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  const supabase = await createClient();
  // The row itself is the ticket: provider_customer_id is NOT NULL (0042),
  // and a cancelled or expired org still belongs in the portal (invoices,
  // resubscribe), so this asks for the row rather than for an active plan.
  const { data } = await supabase
    .from("org_subscriptions")
    .select("provider_customer_id, provider")
    .eq("org_id", org.id)
    .maybeSingle();
  if (!data?.provider_customer_id) redirect("/billing?error=portal");
  // A row another provider wrote (the fake emulator's, on a database now
  // pointed at Stripe — or the reverse) names a customer THIS provider has
  // never heard of; Stripe would 404 the portal session, and the fake portal
  // would happily "manage" a Stripe subscription it cannot touch. As far as
  // this provider is concerned there is no subscription to manage.
  if (data.provider !== env.BILLING_PROVIDER) redirect("/billing?error=portal");
  const url = await providerCall(
    () =>
      selectBillingProvider().createPortalUrl(
        data.provider_customer_id,
        `${env.NEXT_PUBLIC_APP_URL}/billing`,
        "payment_method",
      ),
    "updatePaymentMethod",
  );
  if (!url) redirect("/billing?error=portal_unavailable");
  redirect(url);
}

/* ---------- Changing the subscription we already have ---------- */

/** The line the member reads afterwards, one per way a switch settles
    (plans.ts#switchBilling). Three, not one, because "your plan changed" is
    exactly the sentence that left someone wondering whether they had just
    been charged. */
const SWITCH_RECEIPT: Record<SwitchBilling, string> = {
  charge_now: "charged",
  next_invoice: "credited",
  new_period: "interval",
};

/** Ask the provider for `change`, then project its answer through the same
    `applyBillingEvents` a webhook goes through, so /billing tells the truth
    on the very next render instead of polling for a delivery that is
    seconds away. The provider's own event still arrives; apply_billing_event
    orders by `occurred_at`, so it lands as a no-op on the same state.

    Never called from the client — `changePlan`, `cancelPlan` and
    `resumePlan` below are the three doors, and each re-runs every guard. */
async function applySubscriptionChange(change: SubscriptionChange): Promise<void> {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  const supabase = await createClient();

  let row: Awaited<ReturnType<typeof getProviderSubscription>>;
  try {
    row = await getProviderSubscription(org.id, supabase);
  } catch (error) {
    // A read we could not make is not "no subscription": changing one we
    // can't see is exactly how an org ends up with a plan nobody asked for
    // (startCheckout's rule).
    console.error("[billing] subscription read:", error);
    redirect("/billing?error=change");
  }
  if (!row) redirect("/billing?error=portal");
  // A row another provider wrote names a subscription THIS provider has
  // never heard of (updatePaymentMethod's rule): as far as it is concerned
  // there is nothing to change.
  if (row.provider !== env.BILLING_PROVIDER) redirect("/billing?error=portal");
  // An ended subscription has nothing left to change — Stripe refuses to
  // update a canceled one, and the honest answer is "buy one again".
  if (row.sub.status === "expired") redirect("/billing?error=sub_ended");
  // Already exactly what was asked for (a stale tab, a double submit): the
  // provider would charge nothing and change nothing, so don't ask it.
  if (change.kind === "switch" && change.plan === row.sub.plan && change.interval === row.sub.interval) {
    redirect("/billing");
  }

  const updated = await providerCall(
    () => selectBillingProvider().updateSubscription(row.sub, change),
    `applySubscriptionChange(${change.kind})`,
  );
  if (!updated) redirect("/billing?error=change");

  const now = new Date();
  try {
    await applyBillingEvents(createAdminClient(), [{
      provider: row.provider,
      // Ours, not the provider's — the provider's own event for this same
      // change arrives separately under its own id. Stamped with the
      // instant so a second change in the same session is never mistaken
      // for a replay of this one.
      providerEventId: `${row.provider}-change-${row.sub.providerSubscriptionId}-${now.getTime()}`,
      occurredAt: now.toISOString(),
      orgId: org.id,
      type: "subscription_updated",
      subscription: updated,
      raw: { source: "billing", change },
    }]);
  } catch (error) {
    // The change IS made at the provider — saying "couldn't update your
    // plan" here would be a lie, and the webhook lands the same state
    // within seconds anyway. Log it and report what actually happened.
    console.error("[billing] projecting our own change failed (the webhook will land it):", error);
  }
  // The shell's plan banner and tag read the same row on every page.
  revalidatePath("/", "layout");
  const done = change.kind === "switch"
    ? SWITCH_RECEIPT[switchBilling(row.sub, change)]
    : change.kind === "cancel" ? "cancelled" : "resumed";
  redirect(`/billing?changed=${done}`);
}

/** What the confirmation dialog shows before anyone spends money
    (plan-picker.tsx). Read-only at the provider.

    Returns a verdict rather than throwing: a preview that cannot be made is
    not a reason to block the switch — the dialog falls back to naming the
    rule ("the difference for the rest of this period") instead of a number,
    and the switch itself still enforces every guard. */
export async function previewPlanChange(
  input: { plan: string; interval: string },
): Promise<{ ok: true; dueToday: number; currency: string; billing: SwitchBilling } | { ok: false }> {
  const parsed = planChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  try {
    const row = await getProviderSubscription(org.id, await createClient());
    if (!row || row.provider !== env.BILLING_PROVIDER || row.sub.status === "expired") return { ok: false };
    const change: SwitchChange = { kind: "switch", ...parsed.data };
    const { dueToday, currency } = await selectBillingProvider().previewChange(row.sub, change);
    // The verdict rides along: "nothing today" means one thing on a
    // downgrade (a credit is waiting) and another on an interval change
    // (unused time covered it), and only the server knows which.
    return { ok: true, dueToday, currency, billing: switchBilling(row.sub, change) };
  } catch (error) {
    console.error("[billing] previewPlanChange:", error);
    return { ok: false };
  }
}

/** Form action: switch the existing subscription to another plan/interval —
    a proration on what the org already pays for, never a second purchase.
    An upgrade is charged today; see plans.ts#switchBilling. */
export async function changePlan(formData: FormData): Promise<void> {
  const parsed = planChangeInput.safeParse({ plan: formData.get("plan"), interval: formData.get("interval") });
  if (!parsed.success) redirect("/billing?error=change");
  await applySubscriptionChange({ kind: "switch", ...parsed.data });
}

/** Form action: stop the subscription renewing. Not a deletion — the plan
    runs to the end of the period it was paid for, and `resumePlan` undoes it
    right up to that moment. */
export async function cancelPlan(): Promise<void> {
  await applySubscriptionChange({ kind: "cancel" });
}

/** Form action: undo a scheduled cancellation. */
export async function resumePlan(): Promise<void> {
  await applySubscriptionChange({ kind: "resume" });
}
