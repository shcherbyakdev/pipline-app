import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/queries";
import { upgradeHref } from "@/lib/billing/upgrade-path";
import { getPlanStatus } from "@/features/billing/queries";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* Whether the org may hide "Powered by Booklo" (a paid perk, spec §5) and,
   when it may not, where the toggle sends it. Shared by the two appearance
   surfaces (Website embed, the studio's Settings tab). While billing is off
   nothing is read and every org keeps the toggle it has today. A failed
   read fails OPEN (toggle stays usable) rather than 500-ing the page: the
   same ruling loadPublicOffering follows, and the badge itself is enforced
   server-side regardless (badgeVisible / emailBadgeUrl). */
export async function badgeToggle(orgId: string): Promise<{ canHideBadge: boolean; upgradeHref: string | null }> {
  let canHideBadge = true;
  try {
    // BOTH reads sit inside the try: a flags hiccup fails OPEN exactly like
    // the entitlement read does.
    if (plansEnforced(await getDashboardFlags(orgId))) {
      canHideBadge = (await getEntitlements(orgId, await createClient())).hideBadge;
    }
  } catch (error) {
    console.error("[billing] badge-toggle read failed — toggle stays enabled:", error);
    canHideBadge = true;
  }
  if (canHideBadge) return { canHideBadge, upgradeHref: null };
  const flags = await getDashboardFlags(orgId);
  return { canHideBadge, upgradeHref: upgradeHref(flags, (await getPlanStatus()).plan) };
}
