"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { TimelineOffering, TimelineBlackout } from "@/features/rentals/queries";
import { windowDays } from "@/features/rentals/timeline-geometry";
import {
  conflictSummary,
  detectConflicts,
  monthBands,
  stayInWindow,
  type Conflict,
  type Zoom,
} from "@/features/rentals/timeline-layout";
import { visibleOffset } from "@/features/rentals/pan";
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { isExpiredRequest } from "@/features/scheduling/requests";
import { zonedParts } from "@/features/scheduling/calendar-geometry";
import { BookingDetailDialog } from "@/features/scheduling/components/booking-detail-dialog";
import { NewBookingDialog } from "@/features/scheduling/components/new-booking-dialog";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SPACES } from "@/features/orgs/vocab";
import { TimelineLane, MODE_LABEL, RAIL_PX, RAIL_PAN_STYLE, isWeekend, zoomInHref, type NewStay } from "./timeline-lane";
import { usePanChart } from "./use-pan-chart";

/* The tape chart: every space, one lane per unit, one column per day.
   Reads top to bottom the way a front desk reads its board — a month strip
   over the days, a today line through every lane, stays as bars with the
   hotel handover baked in, hourly rooms as chips, and anything in conflict
   ringed and counted at the top. The window and zoom live on the URL; the
   page's toolbar owns the arrows, Today and the zoom, this component owns
   everything under them.

   It moves like a map. The page sends three windows' worth of days (the
   buffer — pan.ts bufferWindow); the chart renders them all and translates
   the grid so the visible window sits in view (`--base`). A drag adds
   `--pan` under the hand, so real days scroll in from either side, and the
   release shifts the visible start in CLIENT state at once — the URL and
   the server follow in a transition, and when the server's answer lands
   it is the same window recentred in a fresh buffer, so nothing jumps. */

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// A day column never gets narrower than this; below it the visible window
// overflows (clipped) rather than turning into unreadable slivers.
const MIN_CELL_PX = 14;

export function Timeline({
  fromDate,
  bufferFrom,
  days,
  timeZone,
  offerings,
  blackouts,
  bookings,
  scopeSuffix,
  hrefBase,
}: {
  /** The visible window's start, from the URL. */
  fromDate: string;
  /** The first day the page fetched — one window before `fromDate`. */
  bufferFrom: string;
  days: Zoom;
  timeZone: string;
  offerings: TimelineOffering[];
  blackouts: TimelineBlackout[];
  bookings: AdminBooking[];
  /** "&show=…" or "" — the links the chart builds keep the page's scope. */
  scopeSuffix: string;
  /** "/bookings?view=timeline…" with zoom and scope, without `from` — a
      drag through time appends the day it lands on. */
  hrefBase: string;
}) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();

  // The visible start is client state so a drag can move it at once; it
  // resyncs whenever the server sends a new one (arrows, Today, zoom, or
  // the recentring that follows a drag).
  const [from, setFrom] = React.useState(fromDate);
  const [seenFromDate, setSeenFromDate] = React.useState(fromDate);
  if (fromDate !== seenFromDate) {
    setSeenFromDate(fromDate);
    setFrom(fromDate);
  }

  const cols = days * 3;
  const bufferDays = React.useMemo(() => windowDays(bufferFrom, cols), [bufferFrom, cols]);
  const bands = React.useMemo(() => monthBands(bufferDays), [bufferDays]);
  const visIdx = visibleOffset(bufferFrom, from);
  const columns = `${RAIL_PX}px repeat(${cols}, minmax(0, 1fr))`;

  // The clock, seeded in an effect so the server and first client render
  // agree (CalendarWeek idiom); re-read every minute for the today line.
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
  const todayIdx = today === null ? -1 : bufferDays.indexOf(today);
  const nowFrac = now === null ? 0 : zonedParts(now, timeZone).minutes / 1440;

  // A day column is the visible width over the zoom — it decides what a bar
  // can say and how many days a drag has moved.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = React.useState(40);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setCellPx(Math.max(MIN_CELL_PX, (width - RAIL_PX) / days));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [days]);
  const gridWidth = RAIL_PX + cols * cellPx;

  // Grab the chart and drag it through time (use-pan-chart.ts).
  const pan = usePanChart(scrollRef, {
    cellPx,
    onShift: (shift) => {
      const next = addDaysISO(from, shift);
      setFrom(next);
      startTransition(() => router.replace(`${hrefBase}&from=${next}`, { scroll: false }));
    },
  });
  // The shifted window paints with a new `--base`; the drag's `--pan` goes
  // in the same frame, so the days under the hand stay exactly where they are.
  const resetPan = pan.reset;
  React.useLayoutEffect(() => {
    resetPan();
  }, [from, resetPan]);

  const [selected, setSelected] = React.useState<AdminBooking | null>(null);
  // null = closed. Opening always mounts a fresh dialog, which is how the
  // prefill (an empty cell's space/unit/date) reaches its initial state.
  const [newStay, setNewStay] = React.useState<NewStay | null>(null);
  // The whole option, hourly trio included — that is how the dialog knows
  // to open the hours form for a room instead of the nights range picker.
  const offeringOptions = React.useMemo<OfferingOption[]>(
    () =>
      offerings.map((o) => ({
        id: o.id,
        name: o.name,
        rangeMode: o.rangeMode,
        slotIncrementMin: o.slotIncrementMin,
        minDurationMin: o.minDurationMin,
        maxDurationMin: o.maxDurationMin,
      })),
    [offerings],
  );

  const blackoutsByUnit = React.useMemo(() => groupBy(blackouts, (b) => b.unitId), [blackouts]);
  // The stay feed keeps every pending request (rentals/queries.ts) because a
  // live one holds its dates. A LAPSED one holds nothing and is never drawn —
  // unlike the week grid, this feed doesn't filter them out SQL-side. Before
  // the clock is seeded nothing is dropped, so the server and first client
  // render agree.
  const staysByUnit = React.useMemo(
    () =>
      groupBy(
        bookings.filter((b) => b.rentalUnitId !== null && (now === null || !isExpiredRequest(b, now))),
        (b) => b.rentalUnitId!,
      ),
    [bookings, now],
  );

  // Conflicts are a per-unit question, detected over every stay the fetch
  // returned (a turnover clash needs the earlier stay even when it checked
  // out before the window) but counted only for stays the VISIBLE window
  // draws — the banner says "in this window" and Show must have something
  // to show.
  const { conflicts, perOffering } = React.useMemo(() => {
    const merged = new Map<string, Conflict[]>();
    const perOffering = new Map<string, number>();
    for (const o of offerings) {
      let count = 0;
      for (const u of o.units) {
        const stays = (staysByUnit.get(u.id) ?? []).map((b) => ({
          id: b.id,
          clientName: b.clientName,
          startsAt: new Date(b.startsAt),
          endsAt: new Date(b.endsAt),
        }));
        const found = detectConflicts(stays, blackoutsByUnit.get(u.id) ?? [], o.rangeMode, o.turnoverDays, timeZone);
        for (const s of stays) {
          const list = found.get(s.id);
          if (!list || !stayInWindow(s, o.rangeMode, timeZone, o.turnoverDays, from, days)) continue;
          merged.set(s.id, list);
          count += 1;
        }
      }
      perOffering.set(o.id, count);
    }
    return { conflicts: merged, perOffering };
  }, [offerings, staysByUnit, blackoutsByUnit, timeZone, from, days]);
  const summary = React.useMemo(
    () => conflictSummary(conflicts, bookings.map((b) => ({ id: b.id, startsAt: new Date(b.startsAt) }))),
    [conflicts, bookings],
  );
  // The banner's Show: bring the first conflict into view and open its
  // card. A tooltip only opens itself on keyboard focus, so the bar is
  // remounted with the card open (spotlight) and forgets it once the card
  // closes. Vertical scroll only — the chart's horizontal position is the
  // translate, and the bar is in the visible window by construction. At
  // the eight-week zoom an hourly conflict is folded into a count pill with
  // no bar of its own — then Show zooms into that week.
  const [spotlightId, setSpotlightId] = React.useState<string | null>(null);
  const showFirstConflict = () => {
    if (!summary.firstId) return;
    const el = document.getElementById(`tl-stay-${summary.firstId}`);
    const box = scrollRef.current;
    if (el && box) {
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
      setSpotlightId(summary.firstId);
      return;
    }
    const first = bookings.find((b) => b.id === summary.firstId);
    if (first) router.push(zoomInHref(dateInZone(new Date(first.startsAt), timeZone), scopeSuffix));
  };

  if (offerings.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {SPACES.timelineEmpty}{" "}
        <Link href="/rentals" className="underline">
          {SPACES.nav}
        </Link>
        .
      </div>
    );
  }

  return (
    <TooltipProvider delay={150}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {summary.count > 0 ? (
          <div
            role="status"
            className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span>
              {summary.count} booking{summary.count === 1 ? "" : "s"} in conflict in this window
            </span>
            <Button variant="ghost" size="sm" className="text-destructive ml-auto h-7" onClick={showFirstConflict}>
              Show
            </Button>
          </div>
        ) : null}

        {/* The chart fills the viewport under the page chrome, like the week
            grid — a fixed height, because the shell's main grows with its
            content and a sticky header needs a bounded scroll container of
            its own. Vertically it scrolls; lanes stretch to share the
            height when there are few (minmax(auto, 1fr) rows below).
            Sideways it is clipped — the position is the translate, never a
            scrollbar. `--base` puts the visible window in view; `--pan` is
            the drag in progress; the rail cells undo both and stay put. */}
        <div
          ref={scrollRef}
          {...pan.handlers}
          style={{ "--base": `${-visIdx * cellPx}px` } as React.CSSProperties}
          className={cn(
            // Open hand at rest: the chart is draggable through time and the
            // cursor is the affordance that says so (the legend repeats it).
            "min-h-[20rem] cursor-grab overflow-x-hidden overflow-y-auto",
            // Offsets = page chrome above/below the chart inside the panel
            // shell: 44px header + p-6 + toolbar rows + the panel's top gap
            // (md:p-2) and border (see AppShell).
            summary.count > 0 ? "h-[calc(100dvh-17.625rem)]" : "h-[calc(100dvh-14.125rem)]",
            // While dragging: closed hand, no selection, and nothing under
            // the moving pointer reacts (no hover cards popping mid-drag —
            // the container itself still gets the captured events).
            pan.dragging && "cursor-grabbing select-none **:pointer-events-none **:cursor-grabbing",
          )}
        >
          <div
            className="flex min-h-full flex-col will-change-transform"
            style={{ width: gridWidth, transform: "translateX(calc(var(--base, 0px) + var(--pan, 0px)))" }}
          >
            {/* header: the month strip, then one cell per day. Sticky so the
                dates stay put while the lanes scroll under them. */}
            <div className="bg-background sticky top-0 z-30 shrink-0">
              <div className="grid" style={{ gridTemplateColumns: columns }}>
                <div className="bg-background sticky left-0 z-30" style={RAIL_PAN_STYLE} />
                {bands.map((band) => {
                  // A band that began inside the hidden buffer keeps its label
                  // at the visible window's edge rather than off-screen.
                  const hiddenCols = Math.max(0, visIdx - band.colStart);
                  return (
                    <div
                      key={band.label}
                      className="border-border/60 border-l pb-1 text-sm font-semibold first:border-l-0"
                      style={{ gridColumn: `${band.colStart + 2} / span ${band.colSpan}` }}
                    >
                      {hiddenCols < band.colSpan ? (
                        <span className="inline-block pl-2" style={{ marginLeft: hiddenCols * cellPx }}>
                          {band.label}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="border-border grid border-b" style={{ gridTemplateColumns: columns }}>
                <div className="bg-background sticky left-0 z-30" style={RAIL_PAN_STYLE} />
                {bufferDays.map((d) => {
                  const isToday = today === d;
                  // A narrow column (the 4- and 8-week zooms) keeps the
                  // number and drops the weekday; weekends stay legible by
                  // their tint. min-w-0 + overflow-hidden so a label can
                  // never widen the chart.
                  const showWeekday = cellPx >= 44;
                  return (
                    <div key={d} className="flex min-w-0 items-end justify-center overflow-hidden pb-1">
                      <span
                        className={cn(
                          "flex items-baseline gap-1 rounded-md py-0.5",
                          showWeekday ? "px-1.5" : "px-1",
                          isToday && "bg-primary text-primary-foreground",
                        )}
                      >
                        {showWeekday ? (
                          <span
                            className={cn(
                              "text-[10px]",
                              isToday ? "text-primary-foreground/75" : isWeekend(d) ? "text-muted-foreground/60" : "text-muted-foreground",
                            )}
                          >
                            {DAY_LABELS[new Date(`${d}T12:00:00Z`).getUTCDay()]}
                          </span>
                        ) : null}
                        <span className={cn("text-xs font-semibold tabular-nums", !isToday && isWeekend(d) && "text-muted-foreground")}>
                          {Number(d.slice(8, 10))}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* body: a column of one grid per space, sharing the leftover
                height in proportion to their unit counts, so a short board
                fills the screen and a long one scrolls. */}
            <div className="relative flex flex-1 flex-col">
              {/* the today line: through every lane, at the hour it is now.
                  z-[5]: above the lanes' bars, below the sticky rail (z-20). */}
              {todayIdx >= 0 ? (
                <div
                  aria-hidden
                  className="bg-primary pointer-events-none absolute inset-y-0 z-[5] w-0.5"
                  style={{ left: `calc(${RAIL_PX}px + (100% - ${RAIL_PX}px) * ${(todayIdx + nowFrac) / cols})` }}
                />
              ) : null}
              {offerings.map((offering) => {
                const conflictCount = perOffering.get(offering.id) ?? 0;
                return (
                  <div
                    key={offering.id}
                    className="grid"
                    style={{
                      gridTemplateColumns: columns,
                      // header row as tall as its content; every lane row at
                      // least its content, then an equal share of the rest
                      gridTemplateRows: "auto",
                      gridAutoRows: "minmax(auto, 1fr)",
                      flex: `${offering.units.length} 1 auto`,
                    }}
                  >
                    <div className="col-span-full">
                      {/* padding inside the sticky box, so the rail backs the
                          whole row and the today line never shows through
                          the gaps above and below the space's name */}
                      <div
                        className="bg-background sticky left-0 z-20 flex w-fit items-center gap-2 pt-3 pr-3 pb-1"
                        style={RAIL_PAN_STYLE}
                      >
                        <span className="text-sm font-medium">{offering.name}</span>
                        <Badge variant="outline">{MODE_LABEL[offering.rangeMode]}</Badge>
                        <span className="text-muted-foreground text-xs">
                          {offering.units.length} unit{offering.units.length === 1 ? "" : "s"}
                        </span>
                        {conflictCount > 0 ? (
                          <Badge variant="outline" className="border-destructive/50 text-destructive gap-1">
                            <TriangleAlert className="size-3" aria-hidden />
                            {conflictCount} in conflict
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {offering.units.map((unit) => (
                      <TimelineLane
                        key={unit.id}
                        offering={offering}
                        unit={unit}
                        dayList={bufferDays}
                        days={cols}
                        zoom={days}
                        fromDate={bufferFrom}
                        timeZone={timeZone}
                        cellPx={cellPx}
                        today={today}
                        now={now}
                        stays={staysByUnit.get(unit.id) ?? []}
                        blackouts={blackoutsByUnit.get(unit.id) ?? []}
                        conflicts={conflicts}
                        spotlightId={spotlightId}
                        onSpotlightEnd={() => setSpotlightId(null)}
                        scopeSuffix={scopeSuffix}
                        onSelect={setSelected}
                        onNew={setNewStay}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <Legend />

        <BookingDetailDialog
          booking={selected}
          timeZone={timeZone}
          // Rental stays carry no staff (0041) — the timeline only ever
          // selects one, so there is nobody to name.
          staff={[]}
          open={selected !== null}
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
        />
        {newStay === null ? null : (
          <NewBookingDialog
            open
            onOpenChange={(o) => {
              if (!o) setNewStay(null);
            }}
            services={[]}
            spaces={offeringOptions}
            staff={[]}
            defaultStaffId=""
            timeZone={timeZone}
            initial={{ kind: "space", offeringId: newStay.offeringId, unitId: newStay.unitId, date: newStay.date }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function Legend() {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="bg-card inline-block h-3 w-5 rounded-sm border border-l-[3px] border-l-primary" />
        Stay
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="border-border bg-muted/50 inline-block h-3 w-5 rounded-sm border"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)" }}
        />
        Unavailable
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="border-muted-foreground/40 bg-muted/40 inline-block h-3 w-5 rounded-r-sm border border-l-0 border-dashed" />
        Turnover
      </li>
      <li className="flex items-center gap-1.5">
        <TriangleAlert className="text-destructive size-3" aria-hidden />
        Conflict
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="bg-primary inline-block h-3 w-0.5" />
        Now
      </li>
      <li>Drag sideways to move through time.</li>
    </ul>
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}
