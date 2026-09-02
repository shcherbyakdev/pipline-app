"use client";

import { toast } from "sonner";
import type { UpgradeDoor } from "@/lib/billing/refusal";

/** toast.error/warning for an action's refusal — and, when the refusal is a
    plan cap, the door out as the toast's action (the action resolved where
    it leads and what it says, in the admin's language). A full navigation,
    not the router: this is not a component, and the destination is a fresh
    page anyway. */
export function toastRefusal(message: string, upgrade?: UpgradeDoor | null, kind: "error" | "warning" = "error"): void {
  const action = upgrade ? { label: upgrade.label, onClick: () => window.location.assign(upgrade.href) } : undefined;
  if (kind === "warning") toast.warning(message, { action });
  else toast.error(message, { action });
}
