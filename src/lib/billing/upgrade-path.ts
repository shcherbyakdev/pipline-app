// Pure and client-safe: the ONE rule for "where does an org go to get past a
// plan cap". Billing sells the way up while it is on; the waitlist grants Pro,
// so it only helps an org still on Free; otherwise there is no door yet. The
// plan tag, the plan banner, the embed badge chip, the add buttons and the
// gate refusals all read this — never a hard "/billing" link again.
import type { Flags } from "@/lib/flags";
import type { PlanId } from "./plans";
import { UPGRADE_HINTS } from "@/features/scheduling/schema";

export type UpgradeHref = "/billing" | "/waitlist";

export function upgradeHref(flags: Pick<Flags, "billing" | "premium_waitlist">, plan: PlanId): UpgradeHref | null {
  if (flags.billing) return "/billing";
  if (flags.premium_waitlist && plan === "free") return "/waitlist";
  return null;
}

export const UPGRADE_LABELS: Record<UpgradeHref, string> = {
  "/billing": "Open Billing",
  "/waitlist": "Join the waitlist",
};

/** The same door, read back off a refusal the gate wrote (lib/billing/gates.ts
    picks the hint from this rule, so the sentence carries it). Lets a client
    that only holds the error string offer the right action. */
export function upgradeHrefFromRefusal(error: string): UpgradeHref | null {
  if (error.endsWith(UPGRADE_HINTS.billing)) return "/billing";
  if (error.endsWith(UPGRADE_HINTS.waitlist)) return "/waitlist";
  return null;
}
