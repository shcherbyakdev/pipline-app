"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { TimelineOffering, TimelineBlackout } from "@/features/rentals/queries";
import { barSpan, blackoutSpan, turnoverSpan } from "@/features/rentals/timeline-geometry";
import { withUnit } from "@/features/rentals/unit-label";
import {
  continuationLabels,
  dayMonth,
  hourlyByDay,
  labelDensity,
  laneLayout,
  stayInterval,
  stayLengthLabel,
  stayPhase,
  type Conflict,
  type Zoom,
} from "@/features/rentals/timeline-layout";
import { serviceAccent, zonedParts, minToTime } from "@/features/scheduling/calendar-geometry";
import { dateInZone } from "@/features/scheduling/slots";
import { whenLineFor } from "@/features/scheduling/templates";
import { initials } from "@/features/scheduling/staff-slug";
import { ghostWord } from "@/features/scheduling/hold-label";
import { INTL_LOCALES } from "@/i18n/config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* One unit's lane on the tape chart. Nights/days stays are bars (hotel
   handover: check-in afternoon to check-out morning, so back-to-back stays
   share a cell without touching); hourly bookings are chips stacked under
   their day. Anything that overlaps gets its own sub-row (laneLayout) so
   nothing hides anything, and a stay in conflict wears a ring the eye
   cannot miss — red for a hard clash (another stay, a blackout on an
   occupied day), amber for a turnover tail running into a check-in. */

export const RAIL_PX = 208;
/* The rail cells sit inside the grid that is translated to put the visible
   window in view (`--base`, set by the chart) and that a drag moves under
   the hand (`--pan`, use-pan-chart.ts); they translate back by the same
   amount so the unit names stay put while the days move. */
export const RAIL_PAN_STYLE: React.CSSProperties = {
  transform: "translateX(calc(-1 * (var(--base, 0px) + var(--pan, 0px))))",
};
const ROW_PX = 44;
const CHIP_PX = 22;
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
const cellDateLabel = (date: string, intlLocale: string) =>
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

export type NewStay = { offeringId: string; unitId: string; date: string };

/** The two-week zoom around a day, scope kept — the count pill's click and
    the banner's Show when its target is folded into a pill. */
export function zoomInHref(date: string, scopeSuffix: string): string {
  return `/bookings?view=timeline&days=14&from=${date}${scopeSuffix}`;
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
  today,
  now,
  stays,
  blackouts,
  conflicts,
  spotlightId,
  onSpotlightEnd,
  scopeSuffix,
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
  today: string | null;
  now: Date | null;
  stays: AdminBooking[];
  blackouts: TimelineBlackout[];
  conflicts: ReadonlyMap<string, Conflict[]>;
  /** The booking whose card the banner's Show opened, if any. */
  spotlightId: string | null;
  onSpotlightEnd: () => void;
  /** "&show=…" or "" — every link the chart builds carries the scope. */
  scopeSuffix: string;
  onSelect: (b: AdminBooking) => void;
  onNew: (n: NewStay) => void;
}) {
  const t = useTranslations("bookings");
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
  const compact = zoom === 56;
  const maxPerDay = byDay ? Math.max(1, ...[...byDay.values()].map((l) => l.length)) : 1;
  // What this lane is called to a person: the unit for a split space, the
  // space itself for a single-unit one (its unit is never shown anywhere).
  const laneName = offering.units.length > 1 ? unit.name : offering.name;
  const laneHeight =
    mode === "hours"
      ? compact ? ROW_PX : Math.max(ROW_PX, maxPerDay * CHIP_PX + 8)
      : (layout?.rowCount ?? 1) * ROW_PX;

  return (
    <>
      {/* rail: z-20 + the track's `isolate`: the name must paint over any
          bar that scrolls under it horizontally. */}
      <div
        className="bg-background border-border/60 sticky left-0 z-20 flex items-center gap-2 border-b pr-3 pl-6"
        style={{ ...RAIL_PAN_STYLE, minHeight: laneHeight }}
      >
        {/* A single-unit space is named once, in the header above its lane. */}
        {offering.units.length > 1 ? <span className="truncate text-sm">{laneName}</span> : null}
        {unit.active ? null : (
          <Badge variant="outline" className="shrink-0">
            {tCommon("inactive")}
          </Badge>
        )}
      </div>
      <div
        className="border-border/60 relative isolate border-b"
        style={{ gridColumn: `span ${days} / span ${days}`, minHeight: laneHeight }}
      >
        {/* empty cells: the click target for "new booking here". Sits under
            every bar, so only genuinely free days are clickable. */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
          {dayList.map((d) => {
            const past = today !== null && d < today;
            return (
              <button
                key={d}
                type="button"
                disabled={past}
                aria-label={t("timeline.newHere", { unit: laneName, date: cellDateLabel(d, intlLocale) })}
                onClick={() => onNew({ offeringId: offering.id, unitId: unit.id, date: d })}
                className={cn(
                  "border-border/40 border-r last:border-r-0",
                  isWeekend(d) && "bg-muted/25",
                  today === d && "bg-primary/5",
                  past ? "cursor-default opacity-50" : "hover:bg-primary/10",
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
            // The hatch paints ABOVE the bars, so a blackout laid over a stay
            // stays visible through the conflict; it lets pointer events
            // through so the bar underneath keeps its hover and click. The
            // small label pill is the blackout's own target: hover for the
            // dates and reason, click to edit it on the space page.
            <div
              key={bo.id}
              className="pointer-events-none absolute inset-y-1 z-[12] rounded-sm"
              style={{ ...HATCH, left: pct(span.colStart), width: pct(span.colSpan) }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href={`/rentals/${offering.id}`}
                      aria-label={
                        bo.reason
                          ? t("timeline.unavailableRangeReason", { from: dayMonth(bo.startDate, intlLocale), to: dayMonth(bo.endDate, intlLocale), reason: bo.reason })
                          : t("timeline.unavailableRange", { from: dayMonth(bo.startDate, intlLocale), to: dayMonth(bo.endDate, intlLocale) })
                      }
                      className="border-border bg-background/90 text-muted-foreground pointer-events-auto absolute top-0.5 left-0.5 max-w-[calc(100%-4px)] truncate rounded border px-1 text-[10px] leading-4 hover:text-foreground"
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

        {mode !== "hours"
          ? dated.map(({ b, startsAt, endsAt }) => {
              const bar = barSpan({ startsAt, endsAt }, mode, timeZone, fromDate, days);
              const tail = turnoverSpan({ endsAt }, mode, timeZone, offering.turnoverDays, fromDate, days);
              if (bar === null && tail === null) return null;
              const row = layout?.rows.get(b.id) ?? 0;
              const rowCount = layout?.rowCount ?? 1;
              // The lane may be taller than its content when the board is
              // short and rows stretch to fill the screen: every bar sits
              // centred in its sub-row, whatever the row's height.
              const rowMid = `(${row} + 0.5) * 100% / ${rowCount}`;
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
                      title={t("timeline.turnoverAfter", { name: b.clientName })}
                      className="border-muted-foreground/40 bg-muted/40 absolute z-[2] rounded-r-md border border-l-0 border-dashed"
                      style={{
                        top: `calc(${rowMid} - ${ROW_PX / 2 - 6}px)`,
                        height: ROW_PX - 12,
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
                      now={now}
                      conflicts={conflicts.get(b.id) ?? []}
                      widthPx={widthCols * cellPx}
                      clippedLeft={bar.clippedLeft}
                      clippedRight={bar.clippedRight}
                      spotlight={spotlightId === b.id}
                      onSpotlightEnd={onSpotlightEnd}
                      style={{
                        top: `calc(${rowMid} - ${ROW_PX / 2 - 4}px)`,
                        height: ROW_PX - 8,
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
                    now={now}
                    conflicts={conflicts.get(b.id) ?? []}
                    widthPx={cellPx}
                    clippedLeft={false}
                    clippedRight={false}
                    spotlight={spotlightId === b.id}
                    onSpotlightEnd={onSpotlightEnd}
                    chip
                    // the day's stack sits centred in the lane, however tall
                    // the lane is stretched
                    style={{
                      top: `calc(50% - ${(list.length * CHIP_PX) / 2}px + ${i * CHIP_PX}px)`,
                      height: CHIP_PX - 3,
                      left: `calc(${pct(idx)} + 2px)`,
                      width: `calc(${pct(1)} - 4px)`,
                    }}
                    onSelect={onSelect}
                  />
                ))
              ),
            )}
      </div>
    </>
  );
}

/* A stay's bar (or an hourly chip). What it says depends on the room it
   has: name and dates, the name alone, or initials. The hover card (also
   on keyboard focus) always has the whole story, conflicts included. */
function StayBar({
  booking: b,
  startsAt,
  endsAt,
  offering,
  unitName,
  timeZone,
  now,
  conflicts,
  widthPx,
  clippedLeft,
  clippedRight,
  spotlight,
  onSpotlightEnd,
  chip = false,
  style,
  onSelect,
}: {
  booking: AdminBooking;
  startsAt: Date;
  endsAt: Date;
  offering: TimelineOffering;
  unitName: string;
  timeZone: string;
  now: Date | null;
  conflicts: readonly Conflict[];
  widthPx: number;
  clippedLeft: boolean;
  clippedRight: boolean;
  /** Mount with the card open (the banner's Show); reports when it closes. */
  spotlight: boolean;
  onSpotlightEnd: () => void;
  chip?: boolean;
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
  // hold (S2, 0079) reserves its dates the same way and wears the same ghost.
  const pendingRequest = b.status === "pending" || b.status === "pending_payment";
  const ghost = ghostWord(b.status, t);
  const when = whenLineFor({ startsAt, endsAt, isRental: true, rangeMode: mode }, timeZone, intlLocale);
  const time = mode === "hours" ? minToTime(zonedParts(startsAt, timeZone).minutes) : null;
  const note = b.note ? `“${b.note}”` : null;

  return (
    <Tooltip
      key={spotlight ? "spotlight" : "idle"}
      defaultOpen={spotlight}
      onOpenChange={(open) => {
        if (!open && spotlight) onSpotlightEnd();
      }}
    >
      <TooltipTrigger
        render={
          <button
            type="button"
            id={`tl-stay-${b.id}`}
            onClick={() => onSelect(b)}
            aria-label={`${b.clientName}, ${when}${ghost ? `. ${ghost}` : ""}${flagged ? `. ${conflicts.map((c) => conflictText(t, intlLocale, c)).join(". ")}` : ""}`}
            className={cn(
              "absolute z-10 flex overflow-hidden rounded-md border text-left shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
              chip ? "items-center gap-1 px-1 text-[11px]" : "flex-col justify-center px-1.5 text-xs",
              clippedLeft && "rounded-l-none border-l-0",
              clippedRight && "rounded-r-none border-r-0",
              phase === "past" && "opacity-60",
              // A request holds the dates without being confirmed — a ghost
              // of the bar it becomes when the owner accepts.
              pendingRequest && "border-dashed",
              flagged && (hard ? "ring-2 ring-destructive" : "ring-2 ring-amber-500"),
            )}
            style={{
              ...style,
              // The space's hue as a wash over the card, so a lane's bars read
              // as that space's; the left rule is the same hue at full strength.
              // Half the wash while it is only a request.
              background: `color-mix(in srgb, ${accent} ${pendingRequest ? 8 : 16}%, var(--card))`,
              borderLeft: clippedLeft ? undefined : `3px solid ${accent}`,
            }}
          >
            {chip ? (
              <>
                {flagged ? <Flag hard={hard} /> : null}
                {/* What a chip can hold: the time and the name, the time, or
                    just the hour — a 4-week column is ~32px. */}
                {widthPx >= 96 ? (
                  <>
                    <span className="tabular-nums opacity-80">{time}</span>
                    <span className="truncate font-medium">{b.clientName}</span>
                  </>
                ) : (
                  <span className="truncate font-medium tabular-nums">{widthPx >= 56 ? time : time?.slice(0, 2)}</span>
                )}
              </>
            ) : (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  {flagged ? <Flag hard={hard} /> : null}
                  {contLeft ? (
                    <span className="opacity-60" title={contLeft}>
                      <span aria-hidden>←</span>
                      <span className="sr-only">{contLeft}</span>
                    </span>
                  ) : null}
                  <span className="truncate font-medium">{density === "initials" ? initials(b.clientName) : b.clientName}</span>
                  {phase === "current" && density === "full" ? (
                    <span className="bg-primary text-primary-foreground shrink-0 rounded px-1 text-[10px] leading-4">{t("timeline.inHouse")}</span>
                  ) : null}
                  {contRight ? (
                    <span className="ml-auto opacity-60" title={contRight}>
                      <span aria-hidden>→</span>
                      <span className="sr-only">{contRight}</span>
                    </span>
                  ) : null}
                </span>
                {density === "full" ? (
                  <span className="text-muted-foreground truncate text-[11px]">
                    {dates} · {length}
                  </span>
                ) : null}
              </>
            )}
          </button>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5 py-2 text-left">
        <span className="font-medium">{b.clientName}</span>
        <span>{when}</span>
        <span className="opacity-70">
          {length} · {withUnit(offering.name, unitName)}
        </span>
        {b.clientEmail ? <span className="opacity-70">{b.clientEmail}</span> : null}
        {note ? <span className="opacity-70">{note}</span> : null}
        {ghost ? <span>{ghost}</span> : null}
        {phase === "current" ? <span>{t("timeline.inHouseNow")}</span> : phase === "past" ? <span className="opacity-70">{t("timeline.ended")}</span> : null}
        {conflicts.map((c, i) => (
          <span key={i} className={cn("flex items-start gap-1", c.kind === "turnover" ? "text-amber-500" : "text-destructive")}>
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {conflictText(t, intlLocale, c)}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function Flag({ hard }: { hard: boolean }) {
  return <TriangleAlert className={cn("size-3 shrink-0", hard ? "text-destructive" : "text-amber-500")} aria-hidden />;
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
            href={zoomInHref(date, scopeSuffix)}
            aria-label={t("timeline.countPill", { count: list.length, date: cellDateLabel(date, intlLocale), unit: unitName })}
            className={cn(
              "bg-card absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center gap-0.5 rounded-full border px-1 text-[11px] font-medium tabular-nums shadow-sm hover:shadow-md",
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
