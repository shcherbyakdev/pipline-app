"use client";

import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { shiftDays, type SlotWindow } from "@/features/scheduling/slot-paging";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { CHIP, PANEL, STEP_LABEL } from "@/features/booking-page/render/type";
import { useSlotFormats } from "./use-slot-formats";

/* Week columns: Monday to Sunday as columns, the day's number in a disc
   under the weekday (today's disc takes the accent tint, the admin
   calendar's own today mark), times stacked as white chips under each. A
   widget narrower than ~28rem can't hold seven columns and shows the same
   week as day rows instead. */
export function WeekColumns({ byDay, window: w, today, onPick }: { byDay: Map<string, string[]>; window: SlotWindow; today: string; onPick: (iso: string) => void }) {
  const { dayFmt, timeLabel } = useSlotFormats();
  const wdFmt = new Intl.DateTimeFormat(INTL_LOCALES[useLocale()], { weekday: "short", timeZone: "UTC" });
  const days = Array.from({ length: w.days }, (_, i) => shiftDays(w.from, i));
  const chip = (s: string, daySlots: string[], full: boolean) => (
    <Button key={s} variant="outline" className={cn(CHIP, "h-9 tabular-nums", full ? "w-full px-1 text-xs" : "px-3.5")} onClick={() => onPick(s)} aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}>
      {timeLabel(s, daySlots)}
    </Button>
  );
  return (
    <>
      <div className={cn(PANEL, "hidden grid-cols-7 gap-1.5 p-3 @md:grid")}>
        {days.map((d) => {
          const daySlots = byDay.get(d) ?? [];
          const isToday = d === today;
          const has = daySlots.length > 0;
          return (
            <div key={d} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-col items-center gap-1 pb-1">
                <span className={cn("text-xs", has ? "text-foreground font-medium" : "text-muted-foreground")}>{wdFmt.format(new Date(`${d}T00:00:00Z`))}</span>
                <span className={cn("wt-round flex size-7 items-center justify-center rounded-full text-sm tabular-nums", isToday ? "wt-tint font-semibold" : has ? "font-medium" : "text-muted-foreground")}>
                  {Number(d.slice(8))}
                </span>
              </div>
              {has ? daySlots.map((s) => chip(s, daySlots, true)) : <span aria-hidden className="text-muted-foreground/50 text-center text-xs">–</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-4 @md:hidden">
        {days.filter((d) => byDay.has(d)).map((d) => {
          const daySlots = byDay.get(d)!;
          return (
            <div key={d} className="flex flex-col gap-2">
              <p className={STEP_LABEL}>{dayFmt.format(new Date(daySlots[0]!))}</p>
              <div className="flex flex-wrap gap-2">{daySlots.map((s) => chip(s, daySlots, false))}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
