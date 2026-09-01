"use client";

import * as React from "react";
import type { HeatmapDay } from "@/features/scheduling/stats";
import { cn } from "@/lib/utils";
import { CELL, HEAT_LEVELS, PENDING_FILL, PENDING_RING, TODAY_OUTLINE } from "./heatmap-cells";

export function YearGrid({
  weeks,
  todayISO,
  summary,
}: {
  weeks: HeatmapDay[][];
  todayISO: string;
  summary: string;
}) {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);

  // The native `title` tooltip only shows after the OS's ~1s hover delay, so
  // it is the no-JS fallback only: on mount its text moves to data-tip and
  // the attribute goes, or the pair would both appear. Ref-driven (no state)
  // so hovering never re-renders the 371-cell grid — React never touches
  // these attributes again.
  React.useEffect(() => {
    gridRef.current?.querySelectorAll<HTMLElement>("[title]").forEach((el) => {
      el.dataset.tip = el.title;
      el.removeAttribute("title");
    });
  }, []);

  function moveTip(e: React.MouseEvent) {
    const tip = tipRef.current;
    if (!tip) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!cell) {
      tip.hidden = true;
      return;
    }
    tip.textContent = cell.dataset.tip ?? "";
    tip.hidden = false;
    // Fixed-position above the cell (the grid scrolls horizontally, so an
    // in-flow tooltip would clip); clamped so edge cells stay on screen.
    const r = cell.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${r.top - 6}px`;
  }

  const dayFmt = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const monthFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
  // Month label above the column where a new month starts (judged by each
  // column's first in-year day, so the padded first column still reads "Jan").
  const firstDates = weeks.map((week) => week.find((d) => d !== null)?.date ?? "");
  const labels = firstDates.map((date, i) => {
    if (!date) return "";
    const month = date.slice(5, 7);
    return i === 0 || month !== firstDates[i - 1].slice(5, 7)
      ? monthFmt.format(new Date(`${date}T12:00:00Z`))
      : "";
  });
  return (
    <>
      {/* One image to assistive tech — 371 unlabeled cells would be noise; the
          caption above carries the totals and the tooltips serve pointer users. */}
      <div
        ref={gridRef}
        role="img"
        aria-label={summary}
        className="flex gap-[2px] overflow-x-auto pb-1"
        onMouseOver={moveTip}
        onMouseLeave={() => tipRef.current && (tipRef.current.hidden = true)}
      >
        <div className="text-subtle mt-[16px] mr-1 flex flex-col gap-[2px] text-[10px] leading-[13px]">
          {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => (
            <span key={i} className="h-[13px]">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
            {/* Fixed to the cell width so a 3-letter label can't widen its
                column; the text just paints past the box. */}
            <span className="text-subtle h-[14px] w-[13px] text-[10px] leading-[14px] whitespace-nowrap">
              {labels[i]}
            </span>
            {week.map((day, d) =>
              day === null ? (
                <div key={d} className={CELL} />
              ) : (
                <div
                  key={day.date}
                  title={[
                    dayFmt.format(new Date(`${day.date}T12:00:00Z`)),
                    `${day.confirmed} ${day.confirmed === 1 ? "appointment" : "appointments"}`,
                    day.pending > 0 ? `${day.pending} pending` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  data-today={day.date === todayISO ? "" : undefined}
                  className={cn(
                    CELL,
                    day.pending > 0 && day.confirmed === 0
                      ? PENDING_FILL
                      : HEAT_LEVELS[day.level],
                    day.pending > 0 && day.confirmed > 0 && PENDING_RING,
                    day.date === todayISO && TODAY_OUTLINE,
                  )}
                />
              ),
            )}
          </div>
        ))}
      </div>
      {/* ui/tooltip.tsx's panel look, minus the per-cell Base UI machinery
          371 triggers would cost. */}
      <div
        ref={tipRef}
        hidden
        aria-hidden
        className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background"
      />
    </>
  );
}
