import { createClient } from "@/lib/supabase/server";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { evaluateResourceGate } from "@/lib/billing/gates";
import { hrefForHint } from "@/lib/billing/upgrade-path";

/** Would the plan refuse one more person right now? The Team page and
    /team/new ask the SAME gate createStaff does, so neither offers a form the
    action would only refuse — the owner is sent to the door instead
    (null = open the form). */
export async function addStaffGateHref(orgId: string): Promise<string | null> {
  const flags = await getDashboardFlags(orgId);
  if (!plansEnforced(flags)) return null;
  const refused = await evaluateResourceGate(orgId, await createClient(), flags);
  return refused ? hrefForHint(refused.how) : null;
}
