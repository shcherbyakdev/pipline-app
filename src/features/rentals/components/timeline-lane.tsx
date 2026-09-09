"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { TimelineOffering, TimelineBlackout } from "@/features/rentals/queries";
import { barSpan, blackoutSpan, turnoverSpan } from "@/features/rentals/timeline-geometry";
import { withUnit } from "@/features/rentals/unit-label";
import {
  chipDensity,
  continuationLabels,
  dayMonth,
  hourlyByDay,
  labelDensity,
  laneLayout,
  stayInterval,
  stayLengthLabel,
  stayPhase,
  takenColumns,
  timelineHref,
  type Conflict,
  type DragEdge,
  type Zoom,
} from "@/features/rentals/timeline-layout";
import { serviceAccent, zonedParts, minToTime } from "@/features/scheduling/calendar-geometry";
import { dateInZone } from "@/features/scheduling/slots";
import { whenLineFor } from "@/features/scheduling/templates";
import { initials } from "@/features/scheduling/staff-slug";
import { ghostWord } from "@/features/scheduling/hold-label";
import { PAN_THRESHOLD_PX } from "@/features/rentals/pan";
import { INTL_LOCALES } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StayDrag } from "./use-stay-drag";

/* One unit's lane on the tape chart. Nights/days stays are bars (hotel
   handover: check-in afternoon to check-out morning, so back-to-back stays
   share a cell without touching); hourly bookings are chips stacked under
   their day. Anything that overlaps gets its own sub-row (laneLayout) so
   nothing hides anything, and a stay in conflict wears a ring the eye
   cannot miss — red for a hard clash (another stay, a blackout on an
   occupied day), amber for a turnover tail running into a check-in.

   The lane is also where the work happens: a click on a free cell books
   it, a drag across free cells picks the whole run, a drag on a bar hands
   the press to the chart (use-stay-drag.ts) and the lane draws the ghost
   the chart computes for it. */

export const ROW_PX = 36;
export const GROUP_ROW_PX = 32;
const BAR_PX = 26;
const TAIL_PX = 18;
const CHIP_PX = 22;
const EDGE_HANDLE_PX = 8;
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--border) 5px, var(--border) 6px)",
};

// Sun=0. Parsed at noon UTC so no zone can push the date onto its neighbour.
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const isWeekend = (date: string) => {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
};
export const isMonday = (date: string) => weekdayOf(date) === 1;
export const cellDateLabel = (date: string, intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

type BookingsT = ReturnType<typeof useTranslations<"bookings">>;

function conflictText(t: BookingsT, intlLocale: string, c: Conflict): string {
  switch (c.kind) {
    case "blackout":
      return t("timeline.conflictBlackout", {
        from: dayMonth(c.startDate, intlLocale),
        to: dayMonth(c.endDate, intlLocale),
        reason: c.reason ?? "none",
      });
    case "turnover":
      return t("timeline.conflictTurnover", { name: c.withName });
    case "overlap":
      return t("timeline.conflictOverlap", { name: c.withName });
  }
}
const isHard = (cs: readonly Conflict[]) => cs.some((c) => c.kind !== "turnover");

export type NewStay = { offeringId: string; unitId: string; date: string; endDate?: string };

/** What the chart computed for the lane under a drag: where the stay would
    land and whether the run is clean. Drawn by the target lane only. */
export type DragGhost = {
  unitId: string;
  startsAt: Date;
  endsAt: Date;
  conflict: "hard" | "turnover" | null;
  label: string;
};

/** The two-week zoom around a day, scope kept — the count pill's click and
    the banner's Show when its target is folded into a pill. */
export function zoomInHref(date: string, scopeSuffix: string): string {
  return timelineHref(14, date, scopeSuffix);
}

/** The lane's column classes: weekend tint, a firmer rule at each Monday,
    today's tint. Shared with the group rows so the columns read as one. */
export function columnClass(date: string, today: string | null): string {
  return cn(
    "border-border/40 border-r last:border-r-0",
    isMonday(date) && "border-l-border border-l",
    isWeekend(date) && "bg-muted/30",
    today === date && "bg-primary/5",
  );
}

export function TimelineLane({
  offering,
  unit,
  dayList,
  days,
  zoom,
  fromDate,
  timeZone,
  cellPx,
  railPx,
  today,
  now,
  stays,
  ghostIds,
  blackouts,
  conflicts,
  conflictCount,
  spotlightId,
  onSpotlightEnd,
  scopeSuffix,
  headerless,
  collapsed,
  onToggle,
  query,
  focusIdx,
  onCellFocus,
  drag,
  ghost,
  onBarPress,
  pendingId,
  onSelect,
  onNew,
}: {
  offering: TimelineOffering;
  unit: TimelineOffering["units"][number];
  /** Every rendered column — the buffer around the visible window. */
  dayList: string[];
  days: number;
  /** The visible window's zoom, which decides chips vs count pills. */
  zoom: Zoom;
  /** The first rendered column's date. */
  fromDate: string;
  timeZone: string;
  /** Measured width of one day column, for what a bar can say. */
  cellPx: number;
  railPx: number;
  today: string | null;
  now: Date | null;
  stays: AdminBooking[];
  /** S6: which of `stays` this lane only HOSTS — a whole-studio booking on
      one of its rooms, an add-on on a lamp. Drawn as a ghost of the bar the
      booking's own lane carries; the click is the same booking. */
  ghostIds?: Set<string>;
  blackouts: TimelineBlackout[];
  conflicts: ReadonlyMap<string, Conflict[]>;
  /** The space's conflicts, shown in the rail of a single-unit space. */
  conflictCount: number;
  /** The booking whose card the banner's Show opened, if any. */
  spotlightId: string | null;
  onSpotlightEnd: () => void;
  /** "&show=…" or "" — every link the chart builds carries the scope. */
  scopeSuffix: string;
  /** A single-unit space: this row IS the space's row, so the rail names
      the space and carries its mode chip. */
  headerless: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  /** The search box's text; bars that don't match dim. */
  query: string;
  /** The column whose cell is the lane's Tab stop (roving focus), or -1. */
  focusIdx: number;
  onCellFocus: (idx: number) => void;
  drag: StayDrag | null;
  ghost: DragGhost | null;
  onBarPress: (e: React.PointerEvent, booking: AdminBooking, edge: DragEdge) => void;
  /** A move the server is still confirming — its bar waits, dimmed. */
  pendingId: string | null;
  onSelect: (b: AdminBooking) => void;
  onNew: (n: NewStay) => void;
}) {
  const t = useTranslations("bookings");
  const tu = useTranslations("public.units");
  const tCommon = useTranslations("common");
  const intlLocale = INTL_LOCALES[useLocale()];
  const mode = offering.rangeMode;
  const pct = (cols: number) => `${(cols / days) * 100}%`;

  // ---- vertical layout: bars stack in sub-rows, chips stack under their day.
  const dated = React.useMemo(
    () => stays.map((b) => ({ b, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) })),
    [stays],
  );
  const layout = React.useMemo(
    () =>
      mode === "hours"
        ? null
        : laneLayout(dated.map(({ b, startsAt, endsAt }) => ({ id: b.id, ...stayInterval({ startsAt, endsAt }, mode, timeZone, fromDate) }))),
    [dated, mode, timeZone, fromDate],
  );
  const byDay = React.useMemo(
    () => (mode === "hours" ? hourlyByDay(dated, timeZone, fromDate, days) : null),
    [dated, mode, timeZone, fromDate, days],
  );
  // The columns a drag across free cells may not run into (nights/days).
  const taken = React.useMemo(
    () =>
      mode === "hours"
        ? null
        : takenColumns(dated, blackouts, mode, offering.turnoverDays, timeZone, fromDate, days),
    [dated, blackouts, mode, offering.turnoverDays, timeZone, fromDate, days],
  );
  const compact = zoom === 56;
  const maxPerDay = byDay ? Math.max(1, ...[...byDay.values()].map((l) => l.length)) : 1;
  // What this lane is called to a person: the unit for a split space, the
  // space itself for a single-unit one (its unit is never shown anywhere).
  const laneName = headerless ? offering.name : unit.name;
  const laneHeight =
    mode === "hours"
      ? compact ? ROW_PX : Math.max(ROW_PX, maxPerDay * CHIP_PX + 8)
      : (layout?.rowCount ?? 1) * ROW_PX;
  const todayIdx = today === null ? -1 : dayList.indexOf(today);

  // ---- drag across free cells: the run becomes the new booking's dates.
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [sel, setSel] = React.useState<{ a: number; b: number; dragged: boolean; pointerId: number; x: number } | null>(null);
  const colAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || cellPx <= 0) return -1;
    return Math.min(days - 1, Math.max(0, Math.floor((clientX - rect.left) / cellPx)));
  };
  const isPast = (idx: number) => todayIdx >= 0 && idx < todayIdx;
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-tl-bar],[data-tl-pill],a")) return;
    const idx = colAt(e.clientX);
    if (idx < 0 || isPast(idx) || taken?.has(idx)) return;
    setSel({ a: idx, b: idx, dragged: false, pointerId: e.pointerId, x: e.clientX });
  };
  const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sel || mode === "hours") return;
    if (!sel.dragged) {
      if (Math.abs(e.clientX - sel.x) < PAN_THRESHOLD_PX) return;
      try {
        e.currentTarget.setPointerCapture(sel.pointerId);
      } catch {
        // Already gone; the selection still follows while the pointer is over the lane.
      }
    }
    let idx = colAt(e.clientX);
    if (idx < 0) return;
    // The run stops at the first taken or past column on the way.
    const step = idx >= sel.a ? 1 : -1;
    let end = sel.a;
    for (let i = sel.a + step; step > 0 ? i <= idx : i >= idx; i += step) {
      if (taken?.has(i) || isPast(i)) break;
      end = i;
    }
    idx = end;
    setSel((s) => (s && (s.b !== idx || !s.dragged) ? { ...s, b: idx, dragged: true } : s));
  };
  const onTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sel) return;
    setSel(null);
    try {
      e.currentTarget.releasePointerCapture(sel.pointerId);
    } catch {
      // Already released.
    }
    if (e.type === "pointercancel") return;
    const lo = Math.min(sel.a, sel.b);
    const hi = Math.max(sel.a, sel.b);
    onNew({
      offeringId: offering.id,
      unitId: unit.id,
      date: dayList[lo],
      // Nights: the cells are the nights, so the checkout is the day after
      // the last one; days: the return day is the last cell.
      endDate: sel.dragged && mode !== "hours" ? (mode === "nights" ? dayList[hi + 1] : dayList[hi]) : undefined,
    });
  };
  const selRange = sel && sel.dragged ? { lo: Math.min(sel.a, sel.b), hi: Math.max(sel.a, sel.b) } : null;
  const selLength = selRange
    ? mode === "nights"
      ? tu("nights", { count: selRange.hi - selRange.lo + 1 })
      : tu("days", { count: selRange.hi - selRange.lo + 1 })
    : null;

  const draggingId = drag?.booking.id ?? null;
  const q = query.trim().toLowerCase();
  const matches = (b: AdminBooking) => q === "" || b.clientName.toLowerCase().includes(q);

  return (
    <div role="row" className="contents">
      {/* rail: z-20 + the track's `isolate`: the name must paint over any
          bar that scrolls under it horizontally. */}
      <div
        role="rowheader"
        className={cn(
          "bg-background border-border/60 sticky left-0 z-20 flex items-center gap-2 border-b pr-3",
          headerless ? "pl-3" : "pl-7",
        )}
        style={{ minHeight: laneHeight }}
      >
        {headerless ? (
          <GroupLabel
            offering={offering}
            conflictCount={conflictCount}
            collapsed={collapsed}
            onToggle={onToggle}
            inactive={!unit.active}
          />
        ) : (
          <>
            <span className="truncate text-sm">{laneName}</span>
            {unit.active ? null : (
              <Badge variant="outline" className="shrink-0">
                {tCommon("inactive")}
              </Badge>
            )}
          </>
        )}
      </div>
      <div
        ref={trackRef}
        data-tl-unit={unit.id}
        data-tl-offering={offering.id}
        role="presentation"
        className="border-border/60 relative isolate border-b"
        style={{ gridColumn: `span ${days} / span ${days}`, minHeight: laneHeight }}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        {/* cells: the click (or keyboard) target for "new booking here"
            and the Tab stop of the roving grid. Sits under every bar, so
            only genuinely free days are reachable by pointer. */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
          {dayList.map((d, i) => {
            const past = isPast(i);
            return (
              <div
                key={d}
                role="gridcell"
                data-tl-cell={`${unit.id}:${i}`}
                tabIndex={focusIdx === i ? 0 : -1}
                aria-disabled={past || undefined}
                aria-label={t("timeline.newHere", { unit: laneName, date: cellDateLabel(d, intlLocale) })}
                onFocus={() => onCellFocus(i)}
                onKeyDown={(e) => {
                  if (past || (e.key !== "Enter" && e.key !== " ")) return;
                  e.preventDefault();
                  onNew({ offeringId: offering.id, unitId: unit.id, date: d });
                }}
                className={cn(
                  "focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
                  columnClass(d, today),
                  past ? "bg-muted/20" : "hover:bg-primary/10",
                )}
              />
            );
          })}
        </div>

        {blackouts.map((bo) => {
          const span = blackoutSpan(bo.startDate, bo.endDate, fromDate, days);
          if (span === null) return null;
          const wide = span.colSpan * cellPx >= 80;
          return (
            // Full-height hatch BEHIND the bars (Bryntum's resource time
            // ranges): inert to the pointer, so a stay over it keeps its
            // hover and click — the conflict ring on that stay says the
            // rest. The small label pill is the blackout's own target.
            <div
              key={bo.id}
              className="pointer-events-none absolute inset-y-0 z-[1]"
              style={{ ...HATCH, left: pct(span.colStart), width: pct(span.colSpan) }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      data-tl-pill
                      href={`/rentals/${offering.id}`}
                      aria-label={
                        bo.reason
                          ? t("timeline.unavailableRangeReason", { from: dayMonth(bo.startDate, intlLocale), to: dayMonth(bo.endDate, intlLocale), reason: bo.reason })
                          : t("timeline.unavailableRange", { from: dayMonth(bo.startDate, intlLocale), to: dayMonth(bo.endDate, intlLocale) })
                      }
                      className="border-border bg-background/90 text-muted-foreground hover:text-foreground focus-visible:ring-ring pointer-events-auto absolute top-1 left-1 z-[12] max-w-[calc(100%-8px)] truncate rounded border px-1 text-[10px] leading-4 outline-none focus-visible:ring-2"
                    >
                      {wide ? (bo.reason ?? t("timeline.unavailable")) : "▨"}
                    </Link>
                  }
                />
                <TooltipContent className="flex-col items-start gap-0.5 py-2">
                  <span className="font-medium">{t("timeline.unavailable")}</span>
                  <span>
                    {dayMonth(bo.startDate, intlLocale)} – {dayMonth(bo.endDate, intlLocale)}
                    {bo.reason ? ` · ${bo.reason}` : ""}
                  </span>
                  <span className="opacity-70">{t("timeline.editOnSpacePage")}</span>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}

        {/* the run being picked: a wash over the cells and its length */}
        {selRange ? (
          <div
            aria-hidden
            className="bg-primary/15 border-primary/40 pointer-events-none absolute inset-y-1 z-[3] flex items-center rounded-md border px-1.5 text-[11px] font-medium"
            style={{ left: pct(selRange.lo), width: pct(selRange.hi - selRange.lo + 1) }}
          >
            <span className="sticky truncate" style={{ left: railPx + 6 }}>
              {selLength}
            </span>
          </div>
        ) : null}

        {mode !== "hours"
          ? dated.map(({ b, startsAt, endsAt }) => {
              const bar = barSpan({ startsAt, endsAt }, mode, timeZone, fromDate, days);
              const tail = turnoverSpan({ endsAt }, mode, timeZone, offering.turnoverDays, fromDate, days);
              if (bar === null && tail === null) return null;
              const row = layout?.rows.get(b.id) ?? 0;
              const rowMid = `${(row + 0.5) * ROW_PX}px`;
              // Hotel handover: a nightly stay owns the check-in cell only
              // from mid-afternoon and the checkout cell only until morning.
              // A bar clipped by the window's left edge starts flush.
              const halfStart = bar !== null && mode === "nights" && !bar.clippedLeft ? 0.5 : 0;
              const halfEnd = bar?.halfEnd ? 0.5 : 0;
              // Never thinner than half a cell — a legacy same-day row
              // would otherwise vanish into a zero-width bar.
              const widthCols = bar ? Math.max(0.5, bar.colSpan - halfStart - halfEnd) : 0;
              return (
                <React.Fragment key={b.id}>
                  {tail === null ? null : (
                    // Not `pointer-events-none`: the tail has to swallow
                    // its own clicks, or they fall through to the empty
                    // cell and open a walk-in on a day being cleaned.
                    <div
                      data-tl-bar
                      title={t("timeline.turnoverAfter", { name: b.clientName })}
                      className="border-muted-foreground/40 bg-muted/40 absolute z-[2] rounded-r-md border border-l-0 border-dashed"
                      style={{
                        top: `calc(${rowMid} - ${TAIL_PX / 2}px)`,
                        height: TAIL_PX,
                        left: pct(tail.colStart),
                        width: pct(tail.colSpan),
                      }}
                    />
                  )}
                  {bar === null ? null : (
                    <StayBar
                      booking={b}
                      startsAt={startsAt}
                      endsAt={endsAt}
                      offering={offering}
                      unitName={laneName}
                      timeZone={timeZone}
                      railPx={railPx}
                      now={now}
                      conflicts={conflicts.get(b.id) ?? []}
                      widthPx={widthCols * cellPx}
                      clippedLeft={bar.clippedLeft}
                      clippedRight={bar.clippedRight}
                      spotlight={spotlightId === b.id}
                      onSpotlightEnd={onSpotlightEnd}
                      placement={ghostIds?.has(b.id) ?? false}
                      dim={!matches(b)}
                      dragging={draggingId === b.id}
                      pending={pendingId === b.id}
                      onPress={onBarPress}
                      style={{
                        top: `calc(${rowMid} - ${BAR_PX / 2}px)`,
                        height: BAR_PX,
                        left: pct(bar.colStart + halfStart),
                        width: pct(widthCols),
                      }}
                      onSelect={onSelect}
                    />
                  )}
                </React.Fragment>
              );
            })
          : [...byDay!.entries()].map(([idx, list]) =>
              compact ? (
                <CountPill
                  key={idx}
                  date={dayList[idx]}
                  list={list}
                  offering={offering}
                  unitName={laneName}
                  timeZone={timeZone}
                  conflicts={conflicts}
                  scopeSuffix={scopeSuffix}
                  style={{ left: pct(idx), width: pct(1) }}
                />
              ) : (
                list.map(({ b, startsAt, endsAt }, i) => (
                  <StayBar
                    key={b.id}
                    booking={b}
                    startsAt={startsAt}
                    endsAt={endsAt}
                    offering={offering}
                    unitName={laneName}
                    timeZone={timeZone}
                    railPx={railPx}
                    now={now}
                    conflicts={conflicts.get(b.id) ?? []}
                    widthPx={cellPx}
                    clippedLeft={false}
                    clippedRight={false}
                    spotlight={spotlightId === b.id}
                    onSpotlightEnd={onSpotlightEnd}
                    placement={ghostIds?.has(b.id) ?? false}
                    dim={!matches(b)}
                    dragging={draggingId === b.id}
                    pending={pendingId === b.id}
                    onPress={onBarPress}
                    chip
                    style={{
                      top: 4 + i * CHIP_PX,
                      height: CHIP_PX - 3,
                      left: `calc(${pct(idx)} + 2px)`,
                      width: `calc(${pct(1)} - 4px)`,
                    }}
                    onSelect={onSelect}
                  />
                ))
              ),
            )}

        {/* the drag ghost: where the stay would land, and whether it may */}
        {ghost && ghost.unitId === unit.id ? (
          <Ghost ghost={ghost} mode={mode} timeZone={timeZone} fromDate={fromDate} days={days} railPx={railPx} pct={pct} />
        ) : null}
      </div>
    </div>
  );
}

/** The space's name, mode chip, unit count, conflict count and collapse
    toggle — the rail of a group row, or of a single-unit space's row. */
export function GroupLabel({
  offering,
  conflictCount,
  collapsed,
  onToggle,
  inactive = false,
}: {
  offering: TimelineOffering;
  conflictCount: number;
  collapsed?: boolean;
  onToggle?: () => void;
  inactive?: boolean;
}) {
  const t = useTranslations("bookings");
  const tCommon = useTranslations("common");
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <>
      {onToggle ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "timeline.expand" : "timeline.collapse", { name: offering.name })}
          onClick={onToggle}
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring -ml-1 flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2"
        >
          <Chevron className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {/* the name first and whole; the chips give way before it does */}
      <span className="min-w-0 truncate text-sm font-medium" title={offering.name}>
        {offering.name}
      </span>
      <Badge variant="outline" className="shrink-0">
        {t(`timeline.mode.${offering.rangeMode}`)}
      </Badge>
      {inactive ? (
        <Badge variant="outline" className="shrink-0">
          {tCommon("inactive")}
        </Badge>
      ) : null}
      {conflictCount > 0 ? (
        <Badge
          variant="outline"
          className="border-destructive/50 text-destructive shrink-0 gap-1 px-1.5"
          aria-label={t("timeline.inConflict", { count: conflictCount })}
          title={t("timeline.inConflict", { count: conflictCount })}
        >
          <TriangleAlert className="size-3" aria-hidden />
          {conflictCount}
        </Badge>
      ) : null}
    </>
  );
}

/* A stay's bar (or an hourly chip). What it says depends on the room it
   has: name and length, the name alone, or initials; the label sticks to
   the visible part of a long bar while the chart scrolls. The hover card
   (also on keyboard focus) always has the whole story, conflicts included.
   A confirmed, future stay is draggable — its body moves it, its edges
   change a date (nights/days). */
function StayBar({
  booking: b,
  startsAt,
  endsAt,
  offering,
  unitName,
  timeZone,
  railPx,
  now,
  conflicts,
  widthPx,
  clippedLeft,
  clippedRight,
  spotlight,
  onSpotlightEnd,
  placement = false,
  chip = false,
  dim,
  dragging,
  pending,
  onPress,
  style,
  onSelect,
}: {
  booking: AdminBooking;
  startsAt: Date;
  endsAt: Date;
  offering: TimelineOffering;
  unitName: string;
  timeZone: string;
  railPx: number;
  now: Date | null;
  conflicts: readonly Conflict[];
  widthPx: number;
  clippedLeft: boolean;
  clippedRight: boolean;
  /** Mount with the card open (the banner's Show); reports when it closes. */
  spotlight: boolean;
  onSpotlightEnd: () => void;
  /** S6: this lane only hosts the booking (its own lane is elsewhere). */
  placement?: boolean;
  chip?: boolean;
  dim: boolean;
  dragging: boolean;
  pending: boolean;
  onPress: (e: React.PointerEvent, booking: AdminBooking, edge: DragEdge) => void;
  style: React.CSSProperties;
  onSelect: (b: AdminBooking) => void;
}) {
  const tu = useTranslations("public.units");
  const t = useTranslations("bookings");
  const intlLocale = INTL_LOCALES[useLocale()];
  const mode = offering.rangeMode;
  const accent = serviceAccent(b.rentalOfferingId ?? "");
  // Bars adapt by measured width; chips have their own thresholds below.
  const density = labelDensity(widthPx);
  const phase = now ? stayPhase({ startsAt, endsAt }, now) : "upcoming";
  // Where the window cuts a bar, the glyph gets words for screen readers.
  const cont = continuationLabels({ startsAt, endsAt }, timeZone, { clippedLeft, clippedRight }, intlLocale);
  const contLeft = cont.left ? t("timeline.continuesFrom", { date: cont.left }) : null;
  const contRight = cont.right ? t("timeline.continuesTo", { date: cont.right }) : null;
  const length = stayLengthLabel({ startsAt, endsAt }, mode, timeZone, tu);
  const startDate = dateInZone(startsAt, timeZone);
  const endDate = dateInZone(endsAt, timeZone);
  const dates = mode === "hours"
    ? `${minToTime(zonedParts(startsAt, timeZone).minutes)}–${minToTime(zonedParts(endsAt, timeZone).minutes)}`
    : `${dayMonth(startDate, intlLocale)} → ${dayMonth(endDate, intlLocale)}`;
  const flagged = conflicts.length > 0;
  const hard = isHard(conflicts);
  // Lapsed requests never reach a lane (timeline.tsx filters them), so a
  // pending row here is always one the owner can still answer. An unpaid
  // hold (S2, 0079) reserves its dates the same way and wears its own outline.
  const isRequest = b.status === "pending";
  const isHold = b.status === "pending_payment";
  const ghost = ghostWord(b.status, t);
  const when = whenLineFor({ startsAt, endsAt, isRental: true, rangeMode: mode }, timeZone, intlLocale);
  const time = mode === "hours" ? minToTime(zonedParts(startsAt, timeZone).minutes) : null;
  const note = b.note ? `“${b.note}”` : null;
  // On a lane that only hosts the booking, the client's name alone says
  // nothing about WHY the room is gone — the space that took it leads.
  const name = placement ? `${b.serviceName} · ${b.clientName}` : b.clientName;
  // The booking's own bar owns its id and its spotlight; a ghost is a second
  // drawing of the same booking, so it must not duplicate either (the
  // banner's Show scrolls to one element, and one card opens, not three).
  const spot = spotlight && !placement;
  // Only a confirmed stay that has not started moves (the admin reschedule
  // actions refuse the rest); the card says why the others don't.
  const movable = b.status === "confirmed" && !placement && (now === null || startsAt > now) && !pending;
  const whyNot = placement
    ? null
    : isRequest
      ? t("timeline.moveRequest")
      : isHold
        ? t("timeline.moveHold")
        : b.status === "confirmed" && phase !== "upcoming"
          ? t("timeline.moveStarted")
          : null;
  const money =
    b.priceCents !== null && b.currency
      ? b.paidCents > 0
        ? t("timeline.moneyPaid", { price: formatMoney(b.priceCents, b.currency), paid: formatMoney(b.paidCents - b.refundedCents, b.currency) })
        : formatMoney(b.priceCents, b.currency)
      : null;
  const chipD = chipDensity(widthPx);
  const showInHouse = phase === "current" && density === "full" && widthPx >= 160;

  return (
    <Tooltip
      key={spot ? "spotlight" : "idle"}
      defaultOpen={spot}
      onOpenChange={(open) => {
        if (!open && spot) onSpotlightEnd();
      }}
    >
      <TooltipTrigger
        render={
          <button
            type="button"
            data-tl-bar
            id={placement ? undefined : `tl-stay-${b.id}`}
            onClick={() => onSelect(b)}
            onPointerDown={(e) => {
              if (!movable) return;
              const edge = (e.target as HTMLElement).dataset.tlEdge as DragEdge | undefined;
              onPress(e, b, edge ?? "move");
            }}
            aria-label={`${name}, ${when}${ghost ? `. ${ghost}` : ""}${flagged ? `. ${conflicts.map((c) => conflictText(t, intlLocale, c)).join(". ")}` : ""}`}
            className={cn(
              // overflow-clip (not hidden): the label inside is sticky to the
              // chart's scroller, and a hidden overflow would make the bar its
              // own scroll container and pin the label to the bar instead.
              "absolute z-10 flex items-center overflow-clip rounded-md border text-left text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[opacity,box-shadow] hover:shadow-md",
              chip ? "gap-1 px-1 text-[11px]" : "px-1.5",
              movable && "cursor-grab",
              clippedLeft && "rounded-l-none border-l-0",
              clippedRight && "rounded-r-none border-r-0",
              phase === "past" && "opacity-60",
              // A request holds the dates without being confirmed — a ghost
              // of the bar it becomes when the owner accepts; a hold is
              // dotted, waiting on money.
              isRequest && "border-dashed",
              isHold && "border-dotted",
              // A ghost: the booking's real bar is on its own lane.
              placement && "border-dashed opacity-70",
              flagged && (hard ? "ring-2 ring-destructive" : "ring-2 ring-amber-500"),
              dim && "opacity-25",
              dragging && "opacity-30",
              pending && "animate-pulse opacity-60",
            )}
            aria-busy={pending || undefined}
            style={{
              ...style,
              // The space's hue as a wash over the card, so a lane's bars read
              // as that space's; the left rule is the same hue at full strength
              // (the brand's while the guest is in house). Half the wash while
              // it is only a request.
              background: `color-mix(in srgb, ${accent} ${isRequest || isHold ? 8 : 16}%, var(--card))`,
              borderLeft: clippedLeft ? undefined : `3px solid ${phase === "current" ? "var(--primary)" : accent}`,
            }}
          >
            {movable && !chip ? (
              <>
                {clippedLeft ? null : (
                  <span data-tl-edge="start" aria-hidden className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: EDGE_HANDLE_PX }} />
                )}
                {clippedRight ? null : (
                  <span data-tl-edge="end" aria-hidden className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: EDGE_HANDLE_PX }} />
                )}
              </>
            ) : null}
            {chip ? (
              <>
                {flagged ? <Flag hard={hard} /> : null}
                {/* What a chip can hold: the time and the name, the time,
                    the hour — a 4-week column is ~32px. */}
                {chipD === "full" ? (
                  <>
                    <span className="tabular-nums opacity-80">{time}</span>
                    <span className="truncate font-medium">{name}</span>
                  </>
                ) : chipD === "none" ? null : (
                  <span className="truncate font-medium tabular-nums">{chipD === "time" ? time : time?.slice(0, 2)}</span>
                )}
              </>
            ) : (
              <span className="sticky flex min-w-0 items-center gap-1.5" style={{ left: railPx + 6 }}>
                {flagged ? <Flag hard={hard} /> : null}
                {contLeft ? (
                  <span className="opacity-60" title={contLeft}>
                    <span aria-hidden>←</span>
                    <span className="sr-only">{contLeft}</span>
                  </span>
                ) : null}
                <span className="truncate font-medium">{density === "initials" ? initials(b.clientName) : name}</span>
                {density === "full" ? <span className="text-muted-foreground truncate text-[11px]">{length}</span> : null}
                {showInHouse ? (
                  <span className="bg-primary text-primary-foreground shrink-0 rounded px-1 text-[10px] leading-4">{t("timeline.inHouse")}</span>
                ) : null}
                {contRight ? (
                  <span className="opacity-60" title={contRight}>
                    <span aria-hidden>→</span>
                    <span className="sr-only">{contRight}</span>
                  </span>
                ) : null}
              </span>
            )}
          </button>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5 py-2 text-left">
        <span className="font-medium">{name}</span>
        <span>{when}</span>
        <span className="opacity-70">
          {length} · {withUnit(offering.name, unitName)}
          {mode === "hours" ? "" : ` · ${dates}`}
        </span>
        {b.clientEmail ? <span className="opacity-70">{b.clientEmail}</span> : null}
        {money ? <span className="opacity-70">{money}</span> : null}
        {note ? <span className="opacity-70">{note}</span> : null}
        {ghost ? <span>{ghost}</span> : null}
        {phase === "current" ? <span>{t("timeline.inHouseNow")}</span> : phase === "past" ? <span className="opacity-70">{t("timeline.ended")}</span> : null}
        {conflicts.map((c, i) => (
          <span key={i} className={cn("flex items-start gap-1", c.kind === "turnover" ? "text-amber-500" : "text-destructive")}>
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {conflictText(t, intlLocale, c)}
          </span>
        ))}
        {movable ? <span className="opacity-70">{t(chip ? "timeline.dragChipHint" : "timeline.dragBarHint")}</span> : whyNot ? <span className="opacity-70">{whyNot}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function Flag({ hard }: { hard: boolean }) {
  return <TriangleAlert className={cn("size-3 shrink-0", hard ? "text-destructive" : "text-amber-500")} aria-hidden />;
}

/* Where a dragged stay would land: the run it would hold, green when clean,
   amber when it would run into a turnover, red when it may not. The label
   is the drag's live tooltip — the new dates. */
function Ghost({
  ghost,
  mode,
  timeZone,
  fromDate,
  days,
  railPx,
  pct,
}: {
  ghost: DragGhost;
  mode: TimelineOffering["rangeMode"];
  timeZone: string;
  fromDate: string;
  days: number;
  railPx: number;
  pct: (cols: number) => string;
}) {
  const bar = barSpan({ startsAt: ghost.startsAt, endsAt: ghost.endsAt }, mode, timeZone, fromDate, days);
  if (bar === null) return null;
  const halfStart = mode === "nights" && !bar.clippedLeft ? 0.5 : 0;
  const halfEnd = bar.halfEnd ? 0.5 : 0;
  const widthCols = Math.max(0.5, bar.colSpan - halfStart - halfEnd);
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-20 flex items-center rounded-md border-2 px-1.5 text-[11px] font-medium",
        ghost.conflict === "hard"
          ? "border-destructive bg-destructive/15 text-destructive"
          : ghost.conflict === "turnover"
            ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "border-primary bg-primary/15 text-foreground",
      )}
      style={{
        top: mode === "hours" ? 4 : (ROW_PX - BAR_PX) / 2,
        height: mode === "hours" ? CHIP_PX - 3 : BAR_PX,
        left: `calc(${pct(bar.colStart + halfStart)}${mode === "hours" ? " + 2px" : ""})`,
        width: `calc(${pct(widthCols)}${mode === "hours" ? " - 4px" : ""})`,
      }}
    >
      <span className="sticky truncate" style={{ left: railPx + 6 }}>
        {ghost.label}
      </span>
    </div>
  );
}

/* Eight-week zoom: an hourly day is a count. Hover lists the bookings;
   click zooms into that week. */
function CountPill({
  date,
  list,
  offering,
  unitName,
  timeZone,
  conflicts,
  scopeSuffix,
  style,
}: {
  date: string;
  list: { b: AdminBooking; startsAt: Date; endsAt: Date }[];
  offering: TimelineOffering;
  unitName: string;
  timeZone: string;
  conflicts: ReadonlyMap<string, Conflict[]>;
  scopeSuffix: string;
  style: React.CSSProperties;
}) {
  const t = useTranslations("bookings");
  const intlLocale = INTL_LOCALES[useLocale()];
  const flagged = list.some(({ b }) => conflicts.has(b.id));
  const hard = list.some(({ b }) => isHard(conflicts.get(b.id) ?? []));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            data-tl-pill
            href={zoomInHref(date, scopeSuffix)}
            aria-label={t("timeline.countPill", { count: list.length, date: cellDateLabel(date, intlLocale), unit: unitName })}
            className={cn(
              "bg-card focus-visible:ring-ring absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center gap-0.5 rounded-full border px-1 text-[11px] font-medium tabular-nums shadow-sm outline-none hover:shadow-md focus-visible:ring-2",
              flagged && (hard ? "ring-2 ring-destructive" : "ring-2 ring-amber-500"),
            )}
            style={{ ...style, left: `calc(${style.left} + 2px)`, width: `calc(${style.width} - 4px)`, height: 20, borderColor: serviceAccent(offering.id) }}
          >
            {list.length}
          </Link>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5 py-2 text-left">
        <span className="font-medium">
          {cellDateLabel(date, intlLocale)} · {unitName}
        </span>
        {list.map(({ b, startsAt, endsAt }) => (
          <span key={b.id} className={cn(conflicts.has(b.id) && "text-destructive")}>
            {minToTime(zonedParts(startsAt, timeZone).minutes)}–{minToTime(zonedParts(endsAt, timeZone).minutes)} {b.clientName}
          </span>
        ))}
        <span className="opacity-70">{t("timeline.zoomIn")}</span>
      </TooltipContent>
    </Tooltip>
  );
}
