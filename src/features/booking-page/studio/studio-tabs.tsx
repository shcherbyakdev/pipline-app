"use client";

import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

export type StudioTab = "sections" | "settings";
const TABS: ReadonlyArray<{ id: StudioTab; label: string }> = [
  { id: "sections", label: "Sections" },
  { id: "settings", label: "Settings" },
];

/* Local-state tab strip (staff-tabs.tsx look; there is no Tabs primitive).
   Sections = the draft → Publish model; Settings = saved-as-you-go. */
export function StudioTabs({ value, onChange }: { value: StudioTab; onChange: (tab: StudioTab) => void }) {
  return (
    <div role="tablist" aria-label="Booking page" className={SEGMENTED_NAV_CLASS}>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={segmentedItemClass(value === t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
