import type { OrgMode } from "@/features/orgs/mode";
import { countResources, type Entitlements, type ResourceUsage } from "@/lib/billing/entitlements";

/* The "Bookable resources" tile and the plan banner share these (spec §1.2):
   N = what the org's channels count (people + units, countResources), M =
   the plan's cap. Pure — the components stay presentational. */
export type ResourceMeter = { value: string; caption: string; hidden: number };

export function resourceMeter(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): ResourceMeter {
  const used = countResources(usage, mode);
  const cap = ent.bookableResources;
  const hidden = Math.max(0, used - cap);
  // Both-mode on Free (ruling 4): the person fills the one slot, so every
  // unit is hidden — say why, not just that.
  const bothOnOne = mode.offersAppointments && mode.offersRentals && cap === 1 && usage.activeUnits > 0;
  const caption = bothOnOne
    ? "your person takes the slot — spaces need a second resource"
    : hidden > 0
      ? `only the first ${cap} are bookable publicly`
      : "people and units on your booking page";
  return { value: `${used} / ${cap}`, caption, hidden };
}

export function resourceBannerText(hidden: number, cap: number): string {
  return `Your plan allows ${cap} bookable resource${cap === 1 ? "" : "s"} (people and units); ${hidden} ${hidden === 1 ? "isn't" : "aren't"} bookable publicly.`;
}
