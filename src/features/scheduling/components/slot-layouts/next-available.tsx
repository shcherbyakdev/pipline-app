"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { relativeDayLabel } from "@/features/scheduling/slot-paging";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, CHIP, STEP_LABEL } from "@/features/booking-page/render/type";
import { useSlotFormats } from "./use-slot-formats";

const SHOW = 10;

/* Next available: the soonest free times first, grouped by day, ten at a
   time. Paging lives in the body — "Later dates" moves the four-week
   window forward, "Back to the soonest" returns to today's. */
export function NextAvailable({ byDay, today, onPick, onLater, onSooner }: { byDay: Map<string, string[]>; today: string; onPick: (iso: string) => void; onLater: () => void; onSooner: (() => void) | null }) {
  const t = useTranslations("public.slots");
  const { dayFmt, timeLabel } = useSlotFormats();
  const [limit, setLimit] = React.useState(SHOW);
  const days = [...byDay.keys()].sort();
  const total = days.reduce((n, d) => n + byDay.get(d)!.length, 0);
  // The first `limit` times, day by day (a loop, not a closure: the budget
  // is plain render arithmetic).
  const groups: Array<{ d: string; daySlots: string[]; shown: string[] }> = [];
  let budget = limit;
  for (const d of days) {
    if (budget <= 0) break;
    const daySlots = byDay.get(d)!;
    const shown = daySlots.slice(0, budget);
    budget -= shown.length;
    groups.push({ d, daySlots, shown });
  }
  return (
    <>
      {groups.map(({ d, daySlots, shown }) => {
        const rel = relativeDayLabel(d, today);
        return (
          <div key={d} className="flex flex-col gap-2">
            <p className={STEP_LABEL}>
              {rel ? <span>{t(rel)}</span> : null}
              {rel ? <span className="text-muted-foreground font-normal">{" · "}</span> : null}
              <span className={cn(rel && "text-muted-foreground font-normal")}>{dayFmt.format(new Date(daySlots[0]!))}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {shown.map((s) => (
                <Button key={s} variant="outline" className={cn(CHIP, "h-9 px-3.5 tabular-nums")} onClick={() => onPick(s)} aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}>
                  {timeLabel(s, daySlots)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        {total > limit ? (
          <Button variant="outline" size="sm" className={cn(CHIP, "h-8 px-3")} onClick={() => setLimit((n) => n + SHOW)}>{t("showMore")}</Button>
        ) : (
          <Button variant="outline" size="sm" className={cn(CHIP, "h-8 px-3")} onClick={onLater}>{t("laterDates")}</Button>
        )}
        {onSooner ? (
          <button type="button" className={CHANGE_LINK} onClick={onSooner}>{t("backToSoonest")}</button>
        ) : null}
      </div>
    </>
  );
}
