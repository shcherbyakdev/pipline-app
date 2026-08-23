"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SECTION_META } from "../defaults";
import type { SectionType } from "../schema";
import { useSelection } from "./selection";

/* Preview wrapper: hover outline, click-anywhere to select, accent outline +
   type chip when selected, dimmed when the section is hidden. Scrolls
   itself into view when selected from the list. */
export function SectionFrame({
  id, type, hidden, className, style, children,
}: {
  id: string; type: SectionType; hidden: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  const { selectedId, select } = useSelection();
  const selected = selectedId === id;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const label = SECTION_META[type].label;
  return (
    // Click anywhere selects (builder convention). The wrapper carries no
    // role: it contains the section's own buttons, links and form fields,
    // and nesting those inside a role="button" is an ARIA nested-interactive
    // violation — the chip below is the keyboard path instead.
    <div
      ref={ref}
      data-section-id={id}
      data-selected={selected || undefined}
      onClick={() => select(id)}
      style={style}
      className={cn(
        "group relative cursor-pointer rounded-[var(--widget-radius)] outline-2 outline-offset-4 outline-transparent transition-[outline-color]",
        "hover:outline-[color-mix(in_oklab,var(--widget-accent)_50%,transparent)]",
        selected && "outline-[var(--widget-accent)]",
        hidden && "opacity-40",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Edit ${label} section`}
        aria-current={selected ? "true" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          select(id);
        }}
        className={cn(
          "absolute -top-3 left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium text-white outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70",
          selected || hidden ? "opacity-100" : "opacity-0",
        )}
        style={{ background: "var(--widget-accent)" }}
      >
        {label}
        {hidden ? " · hidden" : ""}
      </button>
      {children}
    </div>
  );
}
