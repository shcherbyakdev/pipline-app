"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { applyBillingEvents } from "@/lib/billing/apply-events";
import { actionEvents, checkoutEvents, classifyTestCard, FAKE_ACTIONS, type FakeAction } from "@/lib/billing/fake-emulator";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDevBilling } from "./guard";
import { readFakeRow } from "./queries";

/* The fake provider's back office. Every one of these is what a Stripe
   webhook would have POSTed: the emulator builds the same `BillingEvent[]`
   and hands them to the same `applyBillingEvents`, so walking a scenario here
   exercises the production projection rather than a dev shortcut around it.

   Every action re-runs `requireDevBilling` — a server action is a POST
   endpoint of its own, reachable without ever loading the page that renders
   the form, so the page's guard protects nothing here.

   Nothing is wrapped in try/catch: `redirect()` throws a control-flow error
   that must escape (features/billing/actions.ts idiom), and a DB failure on
   a dev page is best shown as the stack trace it is. */

// ---------- URL helpers ----------

const CHECKOUT_PATH = "/dev/billing/checkout";
const PORTAL_PATH = "/dev/billing/portal";

type CheckoutParams = { org: string; plan: string; interval: string; return: string; customer?: string };

/** Back to the same checkout with the same offer, plus an `error` to render.
    Rebuilt from the submitted fields rather than from a Referer so a form
    posted without JS lands on exactly the page it came from. */
function checkoutUrlWith(p: CheckoutParams, error: string): string {
  const q = new URLSearchParams({ org: p.org, plan: p.plan, interval: p.interval, return: p.return, error });
  if (p.customer) q.set("customer", p.customer);
  return `${CHECKOUT_PATH}?${q}`;
}

function portalUrl(returnTo: string, extra: Record<string, string> = {}): string {
  return `${PORTAL_PATH}?${new URLSearchParams({ return: returnTo, ...extra })}`;
}

/** The app URL to bounce back to after a successful checkout.

    `new URL(returnTo, APP_URL)`: `returnTo` may be relative (`/billing`) and
    the URL constructor throws on those without a base. `.set`, not string
    concatenation, so a `return` that already carries `checkout=success`
    (startCheckout's does) doesn't end up with the param twice.

    The origin check is the open-redirect guard: `return` rides in the query
    string of a page anyone signed in can open, and "dev-only" is not a reason
    to hand out a redirect to an arbitrary host. */
function returnUrlWith(returnTo: string, params: Record<string, string>): string {
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  let target: URL;
  try {
    target = new URL(returnTo, appUrl);
  } catch {
    target = new URL("/billing", appUrl);
  }
  if (target.origin !== appUrl.origin) target = new URL("/billing", appUrl);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

// ---------- Input ----------

/* The card fields are deliberately loose: `classifyTestCard` owns what counts
   as a usable card, and its answer ("invalid") is a decline the form can
   render — a zod failure here would be a 500 instead. The hidden fields are
   strict: they are ours, so anything else is a hand-crafted POST. */
const cardFields = { number: z.string(), exp: z.string(), cvc: z.string() };

const checkoutForm = z.object({
  org: z.string().min(1),
  plan: z.enum(["pro", "team"]),
  interval: z.enum(["month", "year"]),
  return: z.string().min(1),
  customer: z.string().optional(),
  // Collected because a checkout form asks for it; the emulator has nothing
  // to do with it — no card is stored, so there is no cardholder to store.
  name: z.string().optional(),
  ...cardFields,
});

const FAKE_ACTION_IDS = FAKE_ACTIONS.map((a) => a.id) as [FakeAction, ...FakeAction[]];

const portalForm = z.object({ action: z.enum(FAKE_ACTION_IDS), return: z.string().min(1) });
const updateCardForm = z.object({ return: z.string().min(1), name: z.string().optional(), ...cardFields });
const resetForm = z.object({ return: z.string().min(1) });

/** FormData → a plain object zod can read; absent fields stay `undefined`
    (so `.optional()` works) and File entries are dropped. */
function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string") out[key] = value;
  return out;
}

function orgParamOf(formData: FormData): string | null {
  const value = formData.get("org");
  return typeof value === "string" ? value : null;
}

function returnParamOf(formData: FormData): string {
  const value = formData.get("return");
  return typeof value === "string" && value ? value : "/billing";
}

// ---------- Checkout ----------

/** The fake provider's "Pay" button: classify the test card, then emit the
    `subscription_created` a real checkout would have. */
export async function fakeCheckout(formData: FormData): Promise<void> {
  const { org } = await requireDevBilling(orgParamOf(formData));
  const parsed = checkoutForm.safeParse(fields(formData));
  // Only the hidden fields can fail this — the offer is gone, so there is no
  // checkout to send them back to. /billing is where they pick one again.
  if (!parsed.success) redirect("/billing?error=checkout");
  const input = parsed.data;

  const now = new Date();
  const verdict = classifyTestCard(input, now);
  if (verdict === "declined" || verdict === "insufficient_funds" || verdict === "invalid") {
    redirect(checkoutUrlWith(input, verdict));
  }

  // `past_due_first_charge` is the "card attached, first charge failed" case:
  // the subscription IS created, just born past_due, exactly as Stripe does
  // it — so it takes the success path with the flag set, not the decline one.
  await applyBillingEvents(
    createAdminClient(),
    checkoutEvents({
      orgId: org.id,
      plan: input.plan,
      interval: input.interval,
      now,
      existingCustomerId: input.customer,
      firstChargeFails: verdict === "past_due_first_charge",
    }),
  );
  revalidatePath("/billing");
  // `plan` rides along so /billing's activation poller knows WHICH plan to
  // wait for (features/billing/actions.ts).
  redirect(returnUrlWith(input.return, { checkout: "success", plan: input.plan }));
}

// ---------- Portal ----------

/** One of `FAKE_ACTIONS`, applied to the org's current row. */
export async function fakePortalAction(formData: FormData): Promise<void> {
  const { org } = await requireDevBilling();
  const returnTo = returnParamOf(formData);
  const parsed = portalForm.safeParse(fields(formData));
  if (!parsed.success) redirect(portalUrl(returnTo, { error: "bad_action" }));

  const admin = createAdminClient();
  const row = await readFakeRow(admin, org.id);
  // Every action is a change to an existing subscription; without one there
  // is nothing to update (and the page renders no buttons in that state, so
  // getting here means a stale tab).
  if (!row) redirect(portalUrl(returnTo, { error: "no_subscription" }));

  await applyBillingEvents(admin, actionEvents(parsed.data.action, row, org.id, new Date()));
  revalidatePath("/billing");
  redirect(portalUrl(returnTo, { done: parsed.data.action }));
}

/** Re-entering a card. Emits nothing: attaching a card is not a subscription
    change, so no `BillingEvent` describes it — the point is only that the
    form rejects the decline cards the way checkout does. */
export async function fakeUpdateCard(formData: FormData): Promise<void> {
  await requireDevBilling();
  const returnTo = returnParamOf(formData);
  const parsed = updateCardForm.safeParse(fields(formData));
  if (!parsed.success) redirect(portalUrl(returnTo, { error: "card_declined" }));

  // `past_due_first_charge` is not a decline HERE: that card attaches fine,
  // it only fails the charge — and this form runs no charge.
  const verdict = classifyTestCard(parsed.data, new Date());
  const rejected = verdict === "declined" || verdict === "insufficient_funds" || verdict === "invalid";
  redirect(portalUrl(returnTo, rejected ? { error: "card_declined" } : { done: "card_updated" }));
}

/** Back to a clean slate: drop the org's cached subscription so /billing
    reads Free again and the whole ladder can be walked from the top.

    Only `org_subscriptions` — `billing_events` stays. service_role has no
    DELETE on that table by design (0043: an append-only audit + idempotency
    log), and granting one so a dev page can tidy up would widen a production
    privilege for no production reason. Nothing needs it gone either: event
    ids carry the click's millisecond, so a re-walk never collides with the
    log left behind. */
export async function fakeReset(formData: FormData): Promise<void> {
  const { org } = await requireDevBilling();
  const returnTo = returnParamOf(formData);
  const parsed = resetForm.safeParse(fields(formData));
  if (!parsed.success) redirect(portalUrl(returnTo));

  const { error } = await createAdminClient().from("org_subscriptions").delete().eq("org_id", org.id);
  if (error) throw error;
  revalidatePath("/billing");
  redirect(portalUrl(returnTo, { done: "reset" }));
}
