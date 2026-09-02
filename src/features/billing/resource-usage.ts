import type { OrgMode } from "@/features/orgs/mode";
import type { Translator } from "@/i18n/translator";
import { countResources, type Entitlements, type ResourceUsage } from "@/lib/billing/entitlements";

/* The "Bookable resources" tile and the plan banner share these (spec §1.2):
   N = what the org's channels count (people + units, countResources), M =
   the plan's cap. Pure — the components stay presentational and hand in the
   `billing` translator they already hold. */
export type ResourceMeter = { value: string; caption: string; hidden: number };

export function resourceMeter(t: Translator<"billing">, usage: ResourceUsage, mode: OrgMode, ent: Entitlements): ResourceMeter {
  const used = countResources(usage, mode);
  const cap = ent.bookableResources;
  const hidden = Math.max(0, used - cap);
  // Both-mode on Free (ruling 4): the person fills the one slot, so every
  // unit is hidden — say why, not just that.
  const bothOnOne = mode.offersAppointments && mode.offersRentals && cap === 1 && usage.activeUnits > 0;
  const caption = bothOnOne
    ? t("meter.bothOnOne")
    : hidden > 0
      ? t("meter.firstBookable", { count: cap })
      : t("meter.onPage");
  return { value: `${used} / ${cap}`, caption, hidden };
}

export function resourceBannerText(t: Translator<"billing">, hidden: number, cap: number): string {
  return t("banner.resources", { cap, hidden });
}
