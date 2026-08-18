import "server-only";
import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { env } from "@/env";
import { requireOrg, type Org } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* The one gate in front of every `/dev/billing` page and every dev server
   action (plan, Global Constraints). Four conditions, all of which must
   hold before an admin click may write a paid subscription with the service
   role:

   - not production — these pages hand out plans for free;
   - not the real provider — with Stripe on, subscriptions come from Stripe's
     webhooks and nothing else may forge them;
   - the caller's org has `billing` resolved on (lib/flags) — an org with
     billing off has no billing surface, so the emulator has nothing to
     emulate for it;
   - a signed-in member, and when an `org` param is present (checkout carries
     one, in the query string, where anyone could edit it) it must be the
     caller's OWN org — otherwise guessing an org id would upgrade it.

   notFound() rather than 403 for all of them: a dev-only route should not
   confirm it exists in an environment where it doesn't. requireOrg()
   redirects to /login when signed out, which is the right answer for a
   browser hop. */
export async function requireDevBilling(orgParam?: string | null): Promise<{ user: User; org: Org }> {
  if (process.env.NODE_ENV === "production" || env.BILLING_PROVIDER === "stripe") notFound();
  const { user, org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).billing) notFound();
  if (orgParam && orgParam !== org.id) notFound();
  return { user, org };
}
