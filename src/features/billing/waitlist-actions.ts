"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";

/** Form action: put the caller's org on the premium waitlist. One row per
    org (PK), written through the RLS client — the member INSERT policy
    (0066) pins org_id to the caller's org and joined_by to their own email.
    A second join is a no-op, not an error: the row already says yes. */
export async function joinPremiumWaitlist(): Promise<void> {
  const { user, org } = await requireOrg();
  // /waitlist 404s while the org's flag is off, so a POST that gets here is
  // hand-crafted; answer it the same way the route does (startCheckout idiom).
  if (!(await getDashboardFlags(org.id)).premium_waitlist) notFound();
  if (!user.email) redirect("/waitlist?error=join");
  const supabase = await createClient();
  const { error } = await supabase
    .from("premium_waitlist")
    .upsert({ org_id: org.id, joined_by: user.email }, { onConflict: "org_id", ignoreDuplicates: true });
  if (error) {
    console.error("[billing] joinPremiumWaitlist:", error);
    redirect("/waitlist?error=join");
  }
  // The perk lands everywhere at once: the tag, the card, the gates, the
  // public page's resource cap. Whole-tree revalidation is the honest scope.
  revalidatePath("/", "layout");
  redirect("/waitlist?joined=1");
}
