// Pure and client-safe: the ONE rule for "where does an org go to get past a
// plan cap". Billing sells the way up while it is on; the waitlist grants Pro,
// so it only helps an org still on Free; otherwise there is no door yet. The
// plan tag, the plan banner, the embed badge chip, the add buttons and the
// gate refusals all read this — never a hard "/billing" link again.
import type { Flags } from "@/lib/flags";
import type { PlanId } from "./plans";
import type { UpgradeHint } from "./refusal";

export type UpgradeHref = "/billing" | "/waitlist";

export function upgradeHref(flags: Pick<Flags, "billing" | "premium_waitlist">, plan: PlanId): UpgradeHref | null {
  if (flags.billing) return "/billing";
  if (flags.premium_waitlist && plan === "free") return "/waitlist";
  return null;
}

/** The same door, read back off the hint a gate chose (lib/billing/gates.ts
    upgradeHint) — so a page can offer the right action from the refusal's
    data rather than its sentence. */
export function hrefForHint(how: UpgradeHint): UpgradeHref | null {
  return how === "billing" ? "/billing" : how === "waitlist" ? "/waitlist" : null;
}
