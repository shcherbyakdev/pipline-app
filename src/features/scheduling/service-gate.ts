import { createClient } from "@/lib/supabase/server";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { evaluateServiceGate } from "@/lib/billing/gates";
import { hrefForHint } from "@/lib/billing/upgrade-path";

/** Would the plan refuse one more service right now? Every page that offers
    the create dialog (Services, a member's page) asks the gate createService
    asks, and sends a capped org to the door rather than into a form that
    would be refused (null = open the form). */
export async function addServiceGateHref(orgId: string): Promise<string | null> {
  const flags = await getDashboardFlags(orgId);
  if (!plansEnforced(flags)) return null;
  const refused = await evaluateServiceGate(orgId, await createClient(), flags);
  return refused ? hrefForHint(refused.how) : null;
}
