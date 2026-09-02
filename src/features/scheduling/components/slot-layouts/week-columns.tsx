"use client";

import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { shiftDays, type SlotWindow } from "@/features/scheduling/slot-paging";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useSlotFormats } from "./use-slot-formats";

/* Week columns: Monday to Sunday as columns, times stacked under each
   header. A widget narrower than ~28rem can't hold seven columns and shows
   the same week as day rows instead. */
export function WeekColumns({ byDay, window: w, today, onPick }: { byDay: Map<string, string[]>; window: SlotWindow; today: string; onPick: (iso: string) => void }) {
  const { dayFmt, timeLabel } = useSlotFormats();
  const wdFmt = new Intl.DateTimeFormat(INTL_LOCALES[useLocale()], { weekday: "short", timeZone: "UTC" });
  const days = Array.from({ length: w.days }, (_, i) => shiftDays(w.from, i));
  const chip = (s: string, daySlots: string[], full: boolean) => (
    <Button key={s} variant="outline" size="sm" className={cn("wt-surface", full && "w-full px-1 text-xs")} onClick={() => onPick(s)} aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}>
      {timeLabel(s, daySlots)}
    </Button>
  );
  return (
    <>
      <div className="hidden grid-cols-7 gap-1.5 @md:grid">
        {days.map((d) => {
          const daySlots = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <div key={d} className="flex min-w-0 flex-col gap-1.5">
              <div className={cn("flex flex-col items-center pb-1 text-xs", isToday ? "font-semibold" : "text-muted-foreground")}>
                <span>{wdFmt.format(new Date(`${d}T00:00:00Z`))}</span>
                <span className="tabular-nums">{Number(d.slice(8))}</span>
              </div>
              {daySlots.length === 0 ? <span aria-hidden className="text-muted-foreground/50 text-center text-xs">–</span> : daySlots.map((s) => chip(s, daySlots, true))}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-4 @md:hidden">
        {days.filter((d) => byDay.has(d)).map((d) => {
          const daySlots = byDay.get(d)!;
          return (
            <div key={d} className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs font-medium">{dayFmt.format(new Date(daySlots[0]!))}</p>
              <div className="flex flex-wrap gap-2">{daySlots.map((s) => chip(s, daySlots, false))}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
