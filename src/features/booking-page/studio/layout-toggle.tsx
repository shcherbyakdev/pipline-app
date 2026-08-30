"use client";

import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import type { PageDocument } from "../schema";

type Layout = PageDocument["layout"];
const OPTIONS: ReadonlyArray<{ value: Layout; label: string; title: string }> = [
  { value: "column", label: "Column", title: "One column, like today's page" },
  { value: "split", label: "Split", title: "Booking docks to the right on wide screens" },
];

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className={SEGMENTED_NAV_CLASS}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={segmentedItemClass(value === o.value, "h-6 px-2.5 text-xs")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
