"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SectionType } from "../schema";
import type { PreviewChrome } from "./context";
import { useSelection } from "./selection";

/* Preview wrapper: hover outline, click-anywhere to select, accent outline +
   type chip when selected, dimmed when the section is hidden. Scrolls
   itself into view when selected from the list. The chip's words arrive as
   `chrome` (ctx.preview): this subtree's provider speaks the org's language,
   not the admin's. */
export function SectionFrame({
  id, type, hidden, chrome, className, style, children,
}: {
  id: string; type: SectionType; hidden: boolean; chrome: PreviewChrome;
  className?: string; style?: React.CSSProperties; children: React.ReactNode;
}) {
  const { selectedId, select, hoveredId } = useSelection();
  const selected = selectedId === id;
  const listHovered = hoveredId === id;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const chip = chrome.sections[type];
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
        listHovered && "outline-[color-mix(in_oklab,var(--widget-accent)_50%,transparent)]",
        selected && "outline-[var(--widget-accent)]",
        hidden && "opacity-40",
        className,
      )}
    >
      <button
        type="button"
        aria-label={chip.edit}
        aria-current={selected ? "true" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          select(id);
        }}
        className={cn(
          "absolute -top-3 left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-medium outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70",
          selected || hidden ? "opacity-100" : "opacity-0",
        )}
        // The accent's own label colour (widget-theme.ts): white on an org
        // accent, the theme's primary foreground on the ink/off-white fallback.
        style={{ background: "var(--widget-accent)", color: "var(--widget-accent-fg, #ffffff)" }}
      >
        {chip.label}
        {hidden ? ` · ${chrome.hidden}` : ""}
      </button>
      {children}
    </div>
  );
}
