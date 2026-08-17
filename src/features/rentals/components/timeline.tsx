"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { TimelineOffering, TimelineBlackout } from "@/features/rentals/queries";
import {
  TIMELINE_DAYS,
  barSpan,
  blackoutSpan,
  turnoverSpan,
  windowDays,
} from "@/features/rentals/timeline-geometry";
import { serviceAccent } from "@/features/scheduling/calendar-geometry";
import { dateInZone } from "@/features/scheduling/slots";
import { whenLineFor } from "@/features/scheduling/templates";
import { BookingDetailDialog } from "@/features/scheduling/components/booking-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// [unit name rail][21 day columns]. Shared by the header row, the offering
// header rows and every unit row so their columns stay aligned — the whole
// timeline is one grid, which is what guarantees a bar's `left:` percentage
// lines up with the day it names.
const GRID_COLS = "grid-cols-[12rem_repeat(21,minmax(2.25rem,1fr))]";
// Same hatch as the week calendar's closed hours (calendar-week.tsx) so
// "you can't book here" reads the same across both views.
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--border) 5px, var(--border) 6px)",
};

// Sun=0. Parsed at noon UTC so no zone can push the date onto its neighbour.
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date: string) => {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
};
// Column index → percentage across the 21-day track.
const pct = (cols: number) => `${(cols / TIMELINE_DAYS) * 100}%`;

export function Timeline({
  fromDate,
  timeZone,
  offerings,
  blackouts,
  bookings,
  prevHref,
  nextHref,
  todayHref,
  onCellClick,
}: {
  fromDate: string;
  timeZone: string;
  offerings: TimelineOffering[];
  blackouts: TimelineBlackout[];
  bookings: AdminBooking[];
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /* Wired in Task 6 (click an empty cell → new stay). */
  onCellClick?: (unitId: string, offeringId: string, date: string) => void;
}) {
  const days = windowDays(fromDate, TIMELINE_DAYS);

  // Today's tint comes from the client clock, seeded in an effect so the
  // server and first client render agree (same idiom as CalendarWeek).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    const seed = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(seed);
      clearInterval(t);
    };
  }, []);
  const today = now === null ? null : dateInZone(now, timeZone);

  const [selected, setSelected] = React.useState<AdminBooking | null>(null);

  const blackoutsByUnit = React.useMemo(() => {
    const map = new Map<string, TimelineBlackout[]>();
    for (const b of blackouts) {
      const list = map.get(b.unitId);
      if (list) list.push(b);
      else map.set(b.unitId, [b]);
    }
    return map;
  }, [blackouts]);

  const staysByUnit = React.useMemo(() => {
    const map = new Map<string, AdminBooking[]>();
    for (const b of bookings) {
      if (b.rentalUnitId === null) continue; // rentals-only view
      const list = map.get(b.rentalUnitId);
      if (list) list.push(b);
      else map.set(b.rentalUnitId, [b]);
    }
    return map;
  }, [bookings]);

  if (offerings.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No rentals yet — add an offering and units under{" "}
        <Link href="/rentals" className="underline">
          Rentals
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <div className={cn("grid min-w-[960px]", GRID_COLS)}>
          {/* header: window arrows in the rail, then one cell per day */}
          <div className="bg-background sticky left-0 z-20 flex items-center gap-1 pr-3 pb-2">
            <Link
              href={prevHref}
              aria-label="Previous 7 days"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "size-7 p-0")}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link href={todayHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7")}>
              Today
            </Link>
            <Link
              href={nextHref}
              aria-label="Next 7 days"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "size-7 p-0")}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {days.map((d) => {
            const isToday = today === d;
            return (
              <div key={d} className="flex items-center justify-center pb-2">
                <span
                  className={cn(
                    "flex items-baseline gap-1 rounded-md px-1.5 py-1",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "text-[10px]",
                      isToday
                        ? "text-primary-foreground/75"
                        : isWeekend(d)
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground",
                    )}
                  >
                    {DAY_LABELS[weekdayOf(d)]}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      !isToday && isWeekend(d) && "text-muted-foreground",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
                </span>
              </div>
            );
          })}

          {offerings.map((offering) => (
            <React.Fragment key={offering.id}>
              <div className="col-span-full border-border border-t pt-2 pb-1">
                <div className="sticky left-0 flex w-fit items-center gap-2">
                  <span className="text-sm font-medium">{offering.name}</span>
                  <Badge variant="outline">
                    {offering.rangeMode === "nights" ? "Nightly" : "Daily"}
                  </Badge>
                </div>
              </div>
              {offering.units.map((unit) => (
                <React.Fragment key={unit.id}>
                  <div className="bg-background border-border/60 sticky left-0 z-10 flex min-h-9 items-center gap-2 border-b pr-3">
                    <span className="truncate text-sm">{unit.name}</span>
                    {unit.active ? null : (
                      <Badge variant="outline" className="shrink-0">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div
                    className="border-border/60 relative min-h-9 border-b"
                    style={{ gridColumn: `span ${TIMELINE_DAYS} / span ${TIMELINE_DAYS}` }}
                  >
                    {/* empty cells: the click target for "new stay here"
                        (Task 6). Sits under every bar, so only genuinely
                        free days are clickable. */}
                    <div
                      className="absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${TIMELINE_DAYS}, minmax(0, 1fr))` }}
                    >
                      {days.map((d) => (
                        <button
                          key={d}
                          type="button"
                          aria-label={`New booking, ${unit.name}, ${d}`}
                          onClick={() => onCellClick?.(unit.id, offering.id, d)}
                          className={cn(
                            "border-border/40 border-r last:border-r-0",
                            isWeekend(d) && "bg-muted/20",
                            today === d && "bg-primary/5",
                            onCellClick === undefined ? "cursor-default" : "hover:bg-primary/10",
                          )}
                        />
                      ))}
                    </div>

                    {(blackoutsByUnit.get(unit.id) ?? []).map((bo) => {
                      const span = blackoutSpan(bo.startDate, bo.endDate, fromDate, TIMELINE_DAYS);
                      if (span === null) return null;
                      return (
                        <div
                          key={bo.id}
                          title={bo.reason ?? "Unavailable"}
                          className="border-border bg-muted/40 absolute inset-y-1 z-[1] rounded-sm border"
                          style={{ ...HATCH, left: pct(span.colStart), width: pct(span.colSpan) }}
                        />
                      );
                    })}

                    {(staysByUnit.get(unit.id) ?? []).map((b) => {
                      const bar = barSpan(
                        { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) },
                        offering.rangeMode,
                        timeZone,
                        fromDate,
                        TIMELINE_DAYS,
                      );
                      if (bar === null) return null;
                      const tail = turnoverSpan(
                        bar,
                        offering.rangeMode,
                        offering.turnoverDays,
                        TIMELINE_DAYS,
                      );
                      return (
                        <React.Fragment key={b.id}>
                          {tail === null ? null : (
                            <div
                              aria-hidden
                              title="Turnover"
                              className="border-border/60 bg-muted/30 pointer-events-none absolute inset-y-1.5 z-[2] rounded-sm border"
                              style={{
                                ...HATCH,
                                left: pct(tail.colStart),
                                width: pct(tail.colSpan),
                              }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setSelected(b)}
                            title={whenLineFor(
                              {
                                startsAt: new Date(b.startsAt),
                                endsAt: new Date(b.endsAt),
                                isRental: true,
                              },
                              timeZone,
                            )}
                            className={cn(
                              "bg-card absolute inset-y-1 z-10 truncate rounded-md border px-1.5 text-left text-xs shadow-sm hover:shadow",
                              bar.clippedLeft && "rounded-l-none",
                              bar.clippedRight && "rounded-r-none",
                            )}
                            style={{
                              left: pct(bar.colStart),
                              // Nights: the checkout day is only half
                              // occupied — stop the bar mid-cell so the
                              // next guest's check-in can share it.
                              width: pct(bar.colSpan - (bar.halfEnd ? 0.5 : 0)),
                              borderLeft: `3px solid ${serviceAccent(b.rentalOfferingId ?? "")}`,
                            }}
                          >
                            {b.clientName}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      />
    </div>
  );
}
