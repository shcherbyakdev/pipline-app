"use client";

import { toast } from "sonner";
import { UPGRADE_LABELS, upgradeHrefFromRefusal } from "@/lib/billing/upgrade-path";

/** toast.error/warning for an action's refusal — and, when the refusal is a
    plan cap, the door out as the toast's action (a Free org is offered the
    waitlist, a billing-on org Billing). A full navigation, not the router:
    this is not a component, and the destination is a fresh page anyway. */
export function toastRefusal(message: string, kind: "error" | "warning" = "error"): void {
  const href = upgradeHrefFromRefusal(message);
  const action = href ? { label: UPGRADE_LABELS[href], onClick: () => window.location.assign(href) } : undefined;
  if (kind === "warning") toast.warning(message, { action });
  else toast.error(message, { action });
}
