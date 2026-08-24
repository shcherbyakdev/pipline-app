import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { isPaidPlan } from "@/lib/billing/plans";
import { isOverrideActive } from "@/lib/billing/overrides";
import { getBillingOverview } from "@/features/billing/queries";
import { billingErrorMessage } from "@/features/billing/schema";
import { ActivationPoller } from "@/features/billing/components/activation-poller";
import { CurrentPlan } from "@/features/billing/components/current-plan";
import { PlanPicker } from "@/features/billing/components/plan-picker";
import { UsageMeters } from "@/features/billing/components/usage-meters";
import { PageIntro } from "@/components/shell/page-header";

// Fixed locale + UTC (current-plan.tsx idiom): hydration must not depend on
// the server's locale.
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(iso));

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  // Dormant unless the org's `billing` flag resolves true (lib/flags): the
  // route file exists so the Stripe account can be wired first, but nothing
  // links here and it 404s.
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  const { checkout, error, plan } = await searchParams;
  const overview = await getBillingOverview();
  // Back from checkout but the webhook hasn't landed yet — poll, don't lie.
  // `plan` says what was bought, so a Pro org buying Team waits for Team; the
  // older links without it only knew "anything but Free".
  const bought = typeof plan === "string" && isPaidPlan(plan) ? plan : null;
  const activating =
    checkout === "success" &&
    (bought ? overview.entitlements.plan !== bought : overview.entitlements.plan === "free");
  // "Back" from the hosted checkout (startCheckout's cancelUrl): nothing
  // happened, and the page should say so rather than look like a purchase
  // that hasn't landed.
  const cancelled = checkout === "cancelled";
  const errorMessage = billingErrorMessage(error);
  // The Founder code was refused at checkout: the ribbon comes off (the
  // price it names is no longer on offer) and the picker's forms carry
  // `founder=skip` so the next attempt goes straight to list price instead
  // of being refused the same way (features/billing/actions.ts).
  const founderEnded = error === "founder_ended";
  // A live comp beats anything the picker could sell: startCheckout refuses
  // while it lasts, so offering the buttons would only produce that refusal.
  // Destructured (current-plan.tsx idiom) so the guard narrows the binding.
  const { override } = overview;
  const comped = isOverrideActive(override, new Date());

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <PageIntro>
        Your plan and what it covers. Invoices and card details are managed in the secure billing
        portal.
      </PageIntro>
      {errorMessage ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}
      {cancelled ? (
        <p role="status" className="text-muted-foreground text-sm">
          Checkout cancelled — nothing was charged.
        </p>
      ) : null}
      {activating ? <ActivationPoller active /> : null}
      <CurrentPlan overview={overview} />
      <UsageMeters overview={overview} />
      {comped ? (
        <p className="text-muted-foreground text-sm">
          Your plan is complimentary
          {override.expiresAt ? ` until ${formatDate(override.expiresAt)}` : ""}. Plans can be bought once it
          ends.
        </p>
      ) : (
        <PlanPicker
          currentPlan={overview.entitlements.plan}
          founderEligible={overview.founderEligible && !founderEnded}
          skipFounder={founderEnded}
        />
      )}
    </div>
  );
}
