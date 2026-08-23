"use client";

import { cn } from "@/lib/utils";
import type { PageDocument } from "../schema";

type Layout = PageDocument["layout"];
const OPTIONS: ReadonlyArray<{ value: Layout; label: string; title: string }> = [
  { value: "column", label: "Column", title: "One column, like today's page" },
  { value: "split", label: "Split", title: "Booking docks to the right on wide screens" },
];

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="bg-secondary flex h-7 items-center gap-0.5 rounded-md border p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "focus-visible:ring-ring/50 h-6 rounded-[4px] px-2 text-xs outline-none focus-visible:ring-2",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
