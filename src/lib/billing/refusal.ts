import type { Translator } from "@/i18n/translator";
import { hrefForHint, type UpgradeHref } from "./upgrade-path";
import type { ResourceKind } from "./entitlements";

/** Which way out a refusal names — upgradeHref's answer as a key (gates.ts
    upgradeHint): Billing while it is on, the waitlist while that is the
    upgrade path, and honesty when neither can help. */
export type UpgradeHint = "billing" | "waitlist" | "none";

/** What a plan gate decided, as data (i18n Wave 3): the action turns it into
    copy in the admin's language and the client only ever reads the result —
    it never has to recognise a sentence to find the door. `failed` is the
    conservative refusal after a lookup error (spec §7.10). */
export type GateRefusal =
  | { reason: "services"; max: number; how: UpgradeHint }
  | { reason: "resources"; kind: ResourceKind; max: number; how: UpgradeHint }
  | { reason: "failed"; how: "none" };

/** The door out of a cap, ready to render: where it goes and what it says. */
export type UpgradeDoor = { href: UpgradeHref; label: string };

export function refusalCopy(t: Translator<"errors">, r: GateRefusal): { error: string; upgrade: UpgradeDoor | null } {
  if (r.reason === "failed") return { error: t("generic"), upgrade: null };
  const cap =
    r.reason === "services"
      ? t("planLimitServices", { max: r.max })
      : t(r.kind === "people" ? "planLimitPeople" : "planLimitUnits", { max: r.max });
  const href = hrefForHint(r.how);
  return {
    error: `${cap} ${t(`upgradeHint.${r.how}`)}`,
    upgrade: href ? { href, label: t(`upgradeLabel.${r.how === "billing" ? "billing" : "waitlist"}`) } : null,
  };
}
