"use client";

import { cn } from "@/lib/utils";

export type StudioTab = "sections" | "settings";
const TABS: ReadonlyArray<{ id: StudioTab; label: string }> = [
  { id: "sections", label: "Sections" },
  { id: "settings", label: "Settings" },
];

/* Local-state tab strip (staff-tabs.tsx look; there is no Tabs primitive).
   Sections = the draft → Publish model; Settings = saved-as-you-go. */
export function StudioTabs({ value, onChange }: { value: StudioTab; onChange: (tab: StudioTab) => void }) {
  return (
    <div role="tablist" aria-label="Booking page" className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "focus-visible:ring-ring/50 h-7 rounded-[6px] px-3 text-sm outline-none focus-visible:ring-2",
            value === t.id ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
