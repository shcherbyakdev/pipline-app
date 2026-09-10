import type { OrgMode } from "@/features/orgs/mode";
import type { Translator } from "@/i18n/translator";
import { countResources, resourceKind, type Entitlements, type ResourceUsage } from "@/lib/billing/entitlements";

/* The usage tile and the plan banner share these (spec §1.2): N = what the
   org's channel counts (countResources), M = the plan's cap. Both name the
   org's own word — people for an appointments workspace, units for a spaces
   one — never "bookable resources (people and units)", a shape no workspace
   has had since 0073. Pure — the components stay presentational and hand in
   the `billing` translator they already hold. */
export type ResourceMeter = { label: string; value: string; caption: string; hidden: number };

export function resourceMeter(t: Translator<"billing">, usage: ResourceUsage, mode: OrgMode, ent: Entitlements): ResourceMeter {
  const used = countResources(usage, mode);
  const cap = ent.bookableResources;
  const hidden = Math.max(0, used - cap);
  return {
    label: t(`usage.${resourceKind(mode)}`),
    value: `${used} / ${cap}`,
    caption: hidden > 0 ? t("meter.firstBookable", { count: cap }) : t("meter.onPage"),
    hidden,
  };
}

export function resourceBannerText(t: Translator<"billing">, mode: OrgMode, hidden: number, cap: number): string {
  return t(`banner.${resourceKind(mode)}`, { cap, hidden });
}
