import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { plansEnforced, type Flags } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import type { GateRefusal } from "./refusal";
import { hrefForHint } from "./upgrade-path";

/** Would the plan refuse one more of something right now? A page that offers
    a create form asks the SAME gate the action asks (`evaluate`:
    evaluateResourceGate for a person or space, evaluateServiceGate for a
    service) and sends a capped org to the door instead of into a form that
    would only be refused. null = open the form. */
export async function gateHref(
  orgId: string,
  evaluate: (orgId: string, client: SupabaseClient, flags: Flags) => Promise<GateRefusal | null>,
): Promise<string | null> {
  const flags = await getDashboardFlags(orgId);
  if (!plansEnforced(flags)) return null;
  const refused = await evaluate(orgId, await createClient(), flags);
  return refused ? hrefForHint(refused.how) : null;
}
