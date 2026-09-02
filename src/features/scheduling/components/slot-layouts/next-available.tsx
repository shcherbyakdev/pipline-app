"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { relativeDayLabel } from "@/features/scheduling/slot-paging";
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
            <p className="text-muted-foreground text-xs font-medium">
              {rel ? <span className="text-foreground">{t(rel)}</span> : null}
              {rel ? " · " : ""}
              {dayFmt.format(new Date(daySlots[0]!))}
            </p>
            <div className="flex flex-wrap gap-2">
              {shown.map((s) => (
                <Button key={s} variant="outline" size="sm" className="wt-surface" onClick={() => onPick(s)} aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}>
                  {timeLabel(s, daySlots)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        {total > limit ? (
          <Button variant="outline" size="sm" className="wt-surface" onClick={() => setLimit((n) => n + SHOW)}>{t("showMore")}</Button>
        ) : (
          <Button variant="outline" size="sm" className="wt-surface" onClick={onLater}>{t("laterDates")}</Button>
        )}
        {onSooner ? (
          <button type="button" className="text-muted-foreground text-sm underline underline-offset-3" onClick={onSooner}>{t("backToSoonest")}</button>
        ) : null}
      </div>
    </>
  );
}
