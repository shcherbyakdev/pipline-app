import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/queries";
import type { Entitlements } from "@/lib/billing/entitlements";
import { upgradeHref } from "@/lib/billing/upgrade-path";
import { getPlanStatus } from "@/features/billing/queries";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* Whether the org has a paid perk right now and, when it does not, where
   the control that needs it sends the person. One rule for every perk
   toggle on an admin page (the badge on the two appearance surfaces, the
   reminder lead on /notifications). While billing is off nothing is read
   and every org keeps the control it has today. A failed read fails OPEN
   (control stays usable) rather than 500-ing the page: the same ruling
   loadPublicOffering follows, and each perk is enforced server-side
   regardless (badgeVisible / emailBadgeUrl, the drain's
   customRemindersAllowed). */
export async function perkToggle(
  orgId: string,
  perk: (ent: Entitlements) => boolean,
): Promise<{ allowed: boolean; upgradeHref: string | null }> {
  let allowed = true;
  try {
    // BOTH reads sit inside the try: a flags hiccup fails OPEN exactly like
    // the entitlement read does.
    if (plansEnforced(await getDashboardFlags(orgId))) {
      allowed = perk(await getEntitlements(orgId, await createClient()));
    }
  } catch (error) {
    console.error("[billing] perk-toggle read failed — control stays enabled:", error);
    allowed = true;
  }
  if (allowed) return { allowed, upgradeHref: null };
  const flags = await getDashboardFlags(orgId);
  return { allowed, upgradeHref: upgradeHref(flags, (await getPlanStatus()).plan) };
}

/** May the org hide "Powered by Booklo" (spec §5)? Shared by the two
    appearance surfaces (Website embed, the studio's Settings tab). */
export async function badgeToggle(orgId: string): Promise<{ canHideBadge: boolean; upgradeHref: string | null }> {
  const { allowed, upgradeHref } = await perkToggle(orgId, (ent) => ent.hideBadge);
  return { canHideBadge: allowed, upgradeHref };
}
