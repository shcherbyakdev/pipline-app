"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SECTION_META } from "../defaults";
import type { SectionType } from "../schema";
import { useSelection } from "./selection";

/* Preview wrapper: hover outline, click/Enter to select, accent outline +
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
  return (
    <div
      ref={ref}
      data-section-id={id}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${SECTION_META[type].label} section`}
      aria-pressed={selected}
      onClick={() => select(id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          select(id);
        }
      }}
      style={style}
      className={cn(
        "relative cursor-pointer rounded-[var(--widget-radius)] outline-2 outline-offset-4 outline-transparent transition-[outline-color] focus-visible:outline-[var(--widget-accent)]",
        "hover:outline-[color-mix(in_oklab,var(--widget-accent)_50%,transparent)]",
        selected && "outline-[var(--widget-accent)]",
        hidden && "opacity-40",
        className,
      )}
    >
      {selected || hidden ? (
        <span
          className="absolute -top-3 left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ background: "var(--widget-accent)" }}
        >
          {SECTION_META[type].label}
          {hidden ? " · hidden" : ""}
        </span>
      ) : null}
      {children}
    </div>
  );
}
