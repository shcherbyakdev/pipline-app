"use client";

import { useTranslations } from "next-intl";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

export type StudioTab = "sections" | "settings";
const TABS: readonly StudioTab[] = ["sections", "settings"];

/* Local-state tab strip (staff-tabs.tsx look; there is no Tabs primitive).
   Sections = the draft → Publish model; Settings = saved-as-you-go. */
export function StudioTabs({ value, onChange }: { value: StudioTab; onChange: (tab: StudioTab) => void }) {
  const t = useTranslations("studio");
  return (
    <div role="tablist" aria-label={t("name")} className={SEGMENTED_NAV_CLASS}>
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={segmentedItemClass(value === id)}
        >
          {t(`tabs.${id}`)}
        </button>
      ))}
    </div>
  );
}
