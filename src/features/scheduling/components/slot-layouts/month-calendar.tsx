"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { monthGrid, monthOf } from "@/features/rentals/calendar-grid";
import type { SlotWindow } from "@/features/scheduling/slot-paging";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useSlotFormats } from "./use-slot-formats";

/* Calendar + times (the default template): the window's month as a grid,
   days with a free time marked, the picked day's times beside the grid
   (below it on a narrow widget). The picked day resets with the window
   (the parent keys this component by window.from). */
export function MonthCalendar({ byDay, window: w, today, onPick }: { byDay: Map<string, string[]>; window: SlotWindow; today: string; onPick: (iso: string) => void }) {
  const t = useTranslations("public.slots");
  const { dayFmt, timeLabel } = useSlotFormats();
  const dayAriaFmt = new Intl.DateTimeFormat(INTL_LOCALES[useLocale()], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const weekdays = t("weekdays").split(" ");
  const first = [...byDay.keys()].sort()[0] ?? null;
  const [picked, setPicked] = React.useState<string | null>(first);
  const day = picked && byDay.has(picked) ? picked : first;
  const daySlots = day ? (byDay.get(day) ?? []) : [];
  return (
    <div className="grid gap-5 @md:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-7 text-center">
          {weekdays.map((wd) => (
            <span key={wd} className="text-muted-foreground py-1 text-xs font-medium">{wd}</span>
          ))}
        </div>
        <div role="listbox" aria-label={t("daysWithFreeTimes")} className="grid grid-cols-7 gap-y-1">
          {monthGrid(monthOf(w.from)).flat().map((cell, i) => {
            if (!cell) return <span key={`pad-${i}`} aria-hidden />;
            const free = byDay.has(cell);
            const isToday = cell === today;
            return (
              <button
                key={cell}
                type="button"
                role="option"
                aria-selected={cell === day}
                aria-label={dayAriaFmt.format(new Date(`${cell}T00:00:00Z`))}
                disabled={!free}
                onClick={() => setPicked(cell)}
                className={cn(
                  "wt-round mx-auto flex size-9 items-center justify-center rounded-full text-sm tabular-nums outline-none transition-colors duration-150",
                  "focus-visible:ring-2 focus-visible:ring-[var(--widget-accent)] focus-visible:ring-offset-2",
                  // wt-surface (hover tint) is declared after wt-primary in
                  // globals.css and would paint the picked day transparent.
                  free && cell !== day && "wt-surface font-medium",
                  cell === day && "wt-primary font-medium",
                  // Days without a free time stay readable (they say something):
                  // the muted token, not a faded one — weight tells them apart.
                  !free && "text-muted-foreground cursor-default",
                  isToday && cell !== day && "underline underline-offset-4",
                )}
              >
                {Number(cell.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {day ? <p className="text-muted-foreground text-xs font-medium">{dayFmt.format(new Date(daySlots[0]!))}</p> : null}
        <div className="flex flex-wrap gap-2 @md:max-h-72 @md:flex-col @md:flex-nowrap @md:overflow-y-auto">
          {daySlots.map((s) => (
            <Button key={s} variant="outline" size="sm" className="wt-surface @md:w-full" onClick={() => onPick(s)} aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}>
              {timeLabel(s, daySlots)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
