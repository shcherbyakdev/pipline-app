"use client";

import * as React from "react";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "./segmented";

/* Local-state tab strip on the segmented pill (the studio's Sections /
   Settings, the embed page's Code / Style; there is no Tabs primitive). One
   Tab stop with roving focus: arrows move and select, Home/End jump — the
   APG tabs pattern. Panels stay the caller's. */
export function SegmentedTabs<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (tab: T) => void;
  items: ReadonlyArray<{ value: T; label: string }>;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const go = (index: number) => {
    const i = (index + items.length) % items.length;
    onChange(items[i].value);
    refs.current[i]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={SEGMENTED_NAV_CLASS}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") go(i + 1);
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(i - 1);
              else if (e.key === "Home") go(0);
              else if (e.key === "End") go(items.length - 1);
              else return;
              e.preventDefault();
            }}
            className={segmentedItemClass(active)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
