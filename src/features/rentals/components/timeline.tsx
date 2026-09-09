"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { TimelineOffering, TimelineBlackout, TimelinePlacement } from "@/features/rentals/queries";
import { windowDays } from "@/features/rentals/timeline-geometry";
import {
  conflictSummary,
  dayMonth,
  detectConflicts,
  freeUnitsPerDay,
  headerDensity,
  hourlyByDay,
  monthBands,
  moveConflict,
  movedInstant,
  movedRange,
  showsDayNumber,
  shiftDays,
  stayInWindow,
  staysByLane,
  takenColumns,
  timelineHref,
  zoomStep,
  type Conflict,
  type Zoom,
} from "@/features/rentals/timeline-layout";
import { rescheduleRentalBookingAdmin, rescheduleRentalHoursAdmin } from "@/features/rentals/booking-actions";
import { settledColumn, visibleOffset } from "@/features/rentals/pan";
import { daysBetween } from "@/features/rentals/range";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { isExpiredRequest } from "@/features/scheduling/requests";
import { zonedParts, minToTime } from "@/features/scheduling/calendar-geometry";
import { BookingDetailDialog } from "@/features/scheduling/components/booking-detail-dialog";
import { NewBookingDialog } from "@/features/scheduling/components/new-booking-dialog";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { INTL_LOCALES } from "@/i18n/config";
import {
  TimelineLane,
  GroupLabel,
  GROUP_ROW_PX,
  cellDateLabel,
  columnClass,
  isWeekend,
  zoomInHref,
  type DragGhost,
  type NewStay,
} from "./timeline-lane";
import { useDragScroll } from "./use-drag-scroll";
import { useStayDrag, type StayDrop } from "./use-stay-drag";

/* The tape chart: every space, one lane per unit, one column per day.
   Reads top to bottom the way a front desk reads its board — a month strip
   over the days, a today line through every lane, a free-units row per
   split space, stays as bars with the hotel handover baked in, hourly rooms
   as chips, and anything in conflict ringed and counted at the top. The
   window and zoom live on the URL; the page's toolbar owns the arrows,
   Today, the date picker and the zoom, this component owns everything
   under them.

   It is one native scroller. The page sends three windows' worth of days
   (the buffer — pan.ts bufferWindow); the chart renders them all and
   scrolls to the visible window in a layout effect. The wheel, the
   trackpad, the scrollbar, a drag on the date header and the keyboard all
   move it; when a scroll settles, the visible start commits to CLIENT
   state at once and the URL follows in a transition — the server answers
   with the same window recentred in a fresh buffer, so nothing jumps.

   Work happens on the board: click or drag free cells to book them, drag
   a bar to move it (an edge to change a date) with a live ghost that says
   whether it may land, and search for a client. */

const MIN_CELL_PX = 14;
const RAIL_WIDE_PX = 232;
const RAIL_NARROW_PX = 132;
const SETTLE_MS = 120;
const COLLAPSED_KEY = "booklo:timeline-collapsed";

type PendingMove = { id: string; unitId: string; startsAt: string; endsAt: string };

export function Timeline({
  fromDate,
  bufferFrom,
  days,
  timeZone,
  offerings,
  blackouts,
  bookings,
  placements,
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
  /** S6: the other lanes a booking occupies — a whole-studio stay's rooms,
      an add-on's lamps. Each one draws the booking as a ghost. */
  placements: TimelinePlacement[];
  /** "&show=…" or "" — the links the chart builds keep the page's scope. */
  scopeSuffix: string;
  /** "/bookings?view=timeline…" with zoom and scope, without `from` — a
      settled scroll appends the day it landed on. */
  hrefBase: string;
}) {
  const t = useTranslations("bookings");
  const tSpaces = useTranslations("spaces");
  const tu = useTranslations("public.units");
  const intlLocale = INTL_LOCALES[useLocale()];
  // Mon-first two-letter weekdays; the header indexes them by UTC day.
  const weekdays = t("weekdays").split(" ");
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  // A move the server is still confirming draws the stay where it is going;
  // once the transition (action + refresh) is over, the fresh board has it.
  const [pendingMoveState, setPendingMove] = React.useState<PendingMove | null>(null);
  const pendingMove = isPending ? pendingMoveState : null;

  // The visible start is client state so a scroll can move it at once; it
  // resyncs whenever the server sends one we did not ask for (arrows,
  // Today, zoom, the date picker). One we committed ourselves comes back
  // as the recentred buffer and must not drag the view back to it.
  const [from, setFrom] = React.useState(fromDate);
  const [seenFromDate, setSeenFromDate] = React.useState(fromDate);
  const [committed, setCommitted] = React.useState<string | null>(null);
  if (fromDate !== seenFromDate) {
    setSeenFromDate(fromDate);
    if (fromDate !== committed) setFrom(fromDate);
  }

  const cols = days * 3;
  const bufferDays = React.useMemo(() => windowDays(bufferFrom, cols), [bufferFrom, cols]);
  const bands = React.useMemo(() => monthBands(bufferDays, intlLocale), [bufferDays, intlLocale]);
  const visIdx = visibleOffset(bufferFrom, from);

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
  // can say and how many days a scroll has moved. The rail narrows on a
  // phone so the days keep some room.
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = React.useState(40);
  const [railPx, setRailPx] = React.useState(RAIL_WIDE_PX);
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const rail = width < 640 ? RAIL_NARROW_PX : RAIL_WIDE_PX;
      setRailPx(rail);
      setCellPx(Math.max(MIN_CELL_PX, (width - rail) / days));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [days]);
  const gridWidth = railPx + cols * cellPx;
  const columns = `${railPx}px repeat(${cols}, ${cellPx}px)`;
  const density = headerDensity(cellPx);

  // ---- position: the buffer scrolls to the visible window before paint —
  // whenever the buffer, the geometry or the visible start changes (a
  // settled scroll lands exactly on the column it rounded to).
  React.useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = visibleOffset(bufferFrom, from) * cellPx;
  }, [bufferFrom, from, cellPx, railPx]);

  // A scroll that stops commits: the nearest day becomes the visible start
  // (the layout effect above aligns to it), and the URL — with the server's
  // recentred buffer — follows in a transition.
  const settleRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = (next: string) => {
    if (next === from) return;
    setFrom(next);
    setCommitted(next);
    setPendingMove(null);
    startTransition(() => router.replace(`${hrefBase}&from=${next}`, { scroll: false }));
  };
  const onScroll = () => {
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = settledColumn(el.scrollLeft, cellPx);
      const target = idx * cellPx;
      const next = addDaysISO(bufferFrom, idx);
      if (next === from && Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target;
      commit(next);
    }, SETTLE_MS);
  };
  React.useEffect(() => () => {
    if (settleRef.current) clearTimeout(settleRef.current);
  }, []);

  // Ctrl/⌘ + wheel steps the zoom (Bryntum's zoomOnMouseWheel) — a native
  // listener, because React's is passive and the browser would zoom the page.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const at = Date.now();
      if (at - last < 400) return;
      last = at;
      const next = zoomStep(days, e.deltaY > 0 ? 1 : -1);
      if (next !== days) router.push(timelineHref(next, from, scopeSuffix));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [days, from, router, scopeSuffix]);

  // Grab the dates and drag the chart through time.
  const headerDrag = useDragScroll<HTMLDivElement>(scrollerRef);

  // ---- the board's contents
  const [selected, setSelected] = React.useState<AdminBooking | null>(null);
  // null = closed. Opening always mounts a fresh dialog, which is how the
  // prefill (an empty cell's space/unit/dates) reaches its initial state.
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
  const offeringsById = React.useMemo(() => new Map(offerings.map((o) => [o.id, o])), [offerings]);

  const shownBookings = React.useMemo(
    () =>
      pendingMove
        ? bookings.map((b) =>
            b.id === pendingMove.id
              ? { ...b, rentalUnitId: pendingMove.unitId, startsAt: pendingMove.startsAt, endsAt: pendingMove.endsAt }
              : b,
          )
        : bookings,
    [bookings, pendingMove],
  );

  const blackoutsByUnit = React.useMemo(() => groupBy(blackouts, (b) => b.unitId), [blackouts]);
  // The stay feed keeps every pending request (rentals/queries.ts) because a
  // live one holds its dates. A LAPSED one holds nothing and is never drawn —
  // unlike the week grid, this feed doesn't filter them out SQL-side. Before
  // the clock is seeded nothing is dropped, so the server and first client
  // render agree.
  const visibleStays = React.useMemo(
    () => shownBookings.filter((b) => b.rentalUnitId !== null && (now === null || !isExpiredRequest(b, now))),
    [shownBookings, now],
  );
  // What a lane OWNS — conflicts are a question about one unit's own stays.
  const staysByUnit = React.useMemo(() => groupBy(visibleStays, (b) => b.rentalUnitId!), [visibleStays]);
  // S6: what a lane DRAWS — its own stays plus every booking placed on it
  // (a whole studio on each of its rooms, an add-on on its lamps).
  const lanes = React.useMemo(() => staysByLane(visibleStays, placements), [visibleStays, placements]);
  // Which of a lane's bars are ghosts, built once rather than per lane per
  // frame (blackoutsByUnit idiom).
  const ghostsByUnit = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of placements) {
      const set = map.get(p.unitId);
      if (set) set.add(p.bookingId);
      else map.set(p.unitId, new Set([p.bookingId]));
    }
    return map;
  }, [placements]);

  // Conflicts are a per-unit question, detected over every stay the fetch
  // returned (a turnover clash needs the earlier stay even when it checked
  // out before the window) but counted only for stays the VISIBLE window
  // draws — the chip says "in this window" and Show must have something
  // to show. Placements are not asked about: a ghost can never overlap the
  // lane's own stays (0084's EXCLUDE forbids it) and counting it here would
  // report the same clash once per room.
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
    () => conflictSummary(conflicts, shownBookings.map((b) => ({ id: b.id, startsAt: new Date(b.startsAt) }))),
    [conflicts, shownBookings],
  );

  // The free-units row of a split space: per day, the units nobody holds
  // (turnover and blackouts count as held). An hourly group counts its
  // day's bookings instead.
  const groupCounts = React.useMemo(() => {
    const out = new Map<string, number[]>();
    for (const o of offerings) {
      if (o.units.length < 2) continue;
      if (o.rangeMode === "hours") {
        const counts = new Array<number>(cols).fill(0);
        for (const u of o.units) {
          const byDay = hourlyByDay(
            (lanes.get(u.id) ?? []).map((b) => ({ startsAt: new Date(b.startsAt) })),
            timeZone,
            bufferFrom,
            cols,
          );
          for (const [idx, list] of byDay) counts[idx] += list.length;
        }
        out.set(o.id, counts);
      } else {
        const taken = o.units.map((u) =>
          takenColumns(
            (lanes.get(u.id) ?? []).map((b) => ({ startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) })),
            blackoutsByUnit.get(u.id) ?? [],
            o.rangeMode,
            o.turnoverDays,
            timeZone,
            bufferFrom,
            cols,
          ),
        );
        out.set(o.id, freeUnitsPerDay(taken, cols));
      }
    }
    return out;
  }, [offerings, lanes, blackoutsByUnit, timeZone, bufferFrom, cols]);

  // ---- collapsed groups, remembered per browser (useSyncExternalStore so
  // the server and the first client paint agree — everything open — and
  // the stored state applies right after).
  const collapsedRaw = React.useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get, () => "[]");
  const collapsed = React.useMemo(() => new Set(parseIds(collapsedRaw)), [collapsedRaw]);
  const toggleGroup = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedStore.set(JSON.stringify([...next]));
  };

  // ---- search: dim what doesn't match, count, Enter goes to the first.
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = React.useMemo(
    () =>
      q === ""
        ? []
        : visibleStays
            .filter((b) => b.clientName.toLowerCase().includes(q))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
    [visibleStays, q],
  );
  const goToStay = (id: string) => {
    const el = document.getElementById(`tl-stay-${id}`);
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // After the key that asked for it has finished: focusing the bar while
    // Enter is still down would hand the bar the keypress and open it.
    setTimeout(() => el.focus({ preventScroll: true }), 0);
    return true;
  };

  // The chip's Show: bring the first conflict into view and open its card.
  // A tooltip only opens itself on keyboard focus, so the bar is remounted
  // with the card open (spotlight) and forgets it once the card closes. At
  // the eight-week zoom an hourly conflict is folded into a count pill with
  // no bar of its own — then Show zooms into that week.
  const [spotlightId, setSpotlightId] = React.useState<string | null>(null);
  const showFirstConflict = () => {
    if (!summary.firstId) return;
    if (goToStay(summary.firstId)) {
      setSpotlightId(summary.firstId);
      return;
    }
    const first = bookings.find((b) => b.id === summary.firstId);
    if (first) router.push(zoomInHref(dateInZone(new Date(first.startsAt), timeZone), scopeSuffix));
  };

  // ---- the roving grid: one Tab stop, arrows move between cells and
  // lanes, Home/End the visible window's ends, PageUp/PageDown a window,
  // t today, n/p the arrows' step, / the search box.
  const laneOrder = React.useMemo(
    () => offerings.flatMap((o) => (o.units.length > 1 && collapsed.has(o.id) ? [] : o.units.map((u) => u.id))),
    [offerings, collapsed],
  );
  const [focusCell, setFocusCell] = React.useState<{ unitId: string; idx: number } | null>(null);
  const focusTarget = (unitId: string, idx: number) => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-tl-cell="${unitId}:${idx}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.focus({ preventScroll: true });
    setFocusCell({ unitId, idx });
  };
  const [announce, setAnnounce] = React.useState("");
  const shiftWindow = (delta: number) => {
    const next = addDaysISO(from, delta);
    commit(next);
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: visibleOffset(bufferFrom, next) * cellPx, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setAnnounce(t("timeline.windowMoved", { from: dayMonth(next, intlLocale), to: dayMonth(addDaysISO(next, days - 1), intlLocale) }));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const cur = focusCell ?? { unitId: laneOrder[0], idx: visIdx };
    const lane = Math.max(0, laneOrder.indexOf(cur.unitId));
    switch (e.key) {
      case "ArrowLeft":
        focusTarget(cur.unitId, Math.max(0, cur.idx - 1));
        break;
      case "ArrowRight":
        focusTarget(cur.unitId, Math.min(cols - 1, cur.idx + 1));
        break;
      case "ArrowUp":
        if (lane > 0) focusTarget(laneOrder[lane - 1], cur.idx);
        break;
      case "ArrowDown":
        if (lane < laneOrder.length - 1) focusTarget(laneOrder[lane + 1], cur.idx);
        break;
      case "Home":
        focusTarget(cur.unitId, visIdx);
        break;
      case "End":
        focusTarget(cur.unitId, Math.min(cols - 1, visIdx + days - 1));
        break;
      case "PageUp":
        shiftWindow(-days);
        break;
      case "PageDown":
        shiftWindow(days);
        break;
      case "p":
        shiftWindow(-shiftDays(days));
        break;
      case "n":
        shiftWindow(shiftDays(days));
        break;
      case "t":
        router.push(hrefBase);
        break;
      case "/":
        searchRef.current?.focus();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ---- moving a stay: the drag, its live ghost, and the drop.
  const stayDrag = useStayDrag({
    scrollerRef,
    cellPx,
    onDrop: (drop) => applyDrop(drop),
  });
  const drag = stayDrag.state;
  // Where a dragged stay would land and whether it may — the same rules
  // the board rings after the fact (moveConflict), asked before the drop.
  // Called for the drag in progress (the lane draws it) and again for the
  // drop, with the same answer.
  const ghostFor = (drag: StayDrop): DragGhost | null => {
    const b = drag.booking;
    const offering = offeringsById.get(drag.offeringId);
    if (!offering) return null;
    const startsAt = new Date(b.startsAt);
    const endsAt = new Date(b.endsAt);
    let cand: { startsAt: Date; endsAt: Date };
    let label: string;
    if (drag.mode === "hours") {
      const s = movedInstant({ startsAt }, timeZone, drag.dayDelta);
      cand = { startsAt: s, endsAt: new Date(s.getTime() + (endsAt.getTime() - startsAt.getTime())) };
      label = `${dayMonth(dateInZone(s, timeZone), intlLocale)} ${minToTime(zonedParts(s, timeZone).minutes)}`;
    } else {
      const range = movedRange({ startsAt, endsAt }, drag.mode, timeZone, drag.dayDelta, drag.edge) ?? {
        startDate: dateInZone(startsAt, timeZone),
        endDate: dateInZone(endsAt, timeZone),
      };
      cand = { startsAt: wallTimeToUtc(range.startDate, "12:00", timeZone), endsAt: wallTimeToUtc(range.endDate, "12:00", timeZone) };
      const n = drag.mode === "nights" ? daysBetween(range.startDate, range.endDate) : daysBetween(range.startDate, range.endDate) + 1;
      label = `${dayMonth(range.startDate, intlLocale)} → ${dayMonth(range.endDate, intlLocale)} · ${tu(drag.mode === "nights" ? "nights" : "days", { count: n })}`;
    }
    // Everything the target lane draws blocks — its own stays and the ghosts
    // placed on it (a whole studio's rooms are as taken as booked ones).
    const others = (lanes.get(drag.targetUnitId) ?? [])
      .filter((s) => s.id !== b.id)
      .map((s) => ({ id: s.id, clientName: s.clientName, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) }));
    const started = now !== null && cand.startsAt.getTime() <= now.getTime();
    const conflict = started
      ? "hard"
      : moveConflict(cand, others, blackoutsByUnit.get(drag.targetUnitId) ?? [], offering.rangeMode, offering.turnoverDays, timeZone);
    return { unitId: drag.targetUnitId, ...cand, conflict, label };
  };
  const ghost = drag ? ghostFor(drag) : null;

  function applyDrop(drop: StayDrop) {
    const g = ghostFor(drop);
    const b = drop.booking;
    if (!g) return;
    const unchanged = drop.targetUnitId === drop.originUnitId && drop.dayDelta === 0;
    if (unchanged) return;
    if (g.conflict === "hard") {
      toast.error(t("timeline.dropTaken"));
      return;
    }
    // Normalised to "…Z": the action's schema takes a strict ISO instant, and
    // the feed's rows carry Postgres's "+00:00" form.
    const old = { unitId: drop.originUnitId, startsAt: new Date(b.startsAt).toISOString(), endsAt: new Date(b.endsAt).toISOString() };
    if (drop.mode === "hours") {
      const next = { unitId: drop.targetUnitId, startsAt: g.startsAt.toISOString(), endsAt: g.endsAt.toISOString() };
      // A move is a new row; Undo moves THAT row back.
      const run = (id: string, to: typeof next, undo: typeof next | null) =>
        move(
          { ...b, id },
          to,
          () => rescheduleRentalHoursAdmin({ id, unitId: to.unitId, startsAt: to.startsAt }),
          undo ? (newId) => run(newId, undo, null) : null,
          false,
        );
      run(b.id, next, old);
    } else {
      const range = movedRange({ startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) }, drop.mode, timeZone, drop.dayDelta, drop.edge);
      if (!range) return;
      const toDates = (r: { startDate: string; endDate: string }, unitId: string) => ({
        unitId,
        startsAt: wallTimeToUtc(r.startDate, "12:00", timeZone).toISOString(),
        endsAt: wallTimeToUtc(r.endDate, "12:00", timeZone).toISOString(),
        ...r,
      });
      const next = toDates(range, drop.targetUnitId);
      const oldRange = { startDate: dateInZone(new Date(b.startsAt), timeZone), endDate: dateInZone(new Date(b.endsAt), timeZone) };
      const prev = toDates(oldRange, drop.originUnitId);
      const run = (id: string, to: typeof next, undo: typeof next | null) =>
        move(
          { ...b, id },
          to,
          () => rescheduleRentalBookingAdmin({ id, unitId: to.unitId, startDate: to.startDate, endDate: to.endDate }),
          undo ? (newId) => run(newId, undo, null) : null,
          true,
        );
      run(b.id, next, prev);
    }
  }

  // One move: the bar waits where it is going, the server decides, the toast
  // says what happened and offers the way back. `router.refresh()` inside
  // the transition keeps it pending until the fresh board has painted, so
  // the waiting bar hands over to the real one without a flicker.
  function move(
    b: AdminBooking,
    to: { unitId: string; startsAt: string; endsAt: string },
    action: () => Promise<
      { ok: true; id: string; unitChanged: boolean; datesChanged: boolean; emailed: boolean } | { ok: false; error: string; datesTaken?: boolean }
    >,
    undo: ((newId: string) => void) | null,
    isStay: boolean,
  ) {
    setPendingMove({ id: b.id, ...to });
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      const key = result.datesChanged
        ? isStay
          ? result.emailed ? "move.stayDoneEmailed" : "move.stayDone"
          : result.emailed ? "move.doneEmailed" : "move.done"
        : result.unitChanged
          ? result.emailed ? "move.unitChangedEmailed" : "move.unitChanged"
          : isStay ? "move.stayDone" : "move.done";
      toast.success(t(key), undo ? { action: { label: t("timeline.undo"), onClick: () => undo(result.id) } } : undefined);
      setAnnounce(t(key));
      router.refresh();
    });
  }

  if (offerings.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {tSpaces("timelineEmpty")}{" "}
        <Link href="/rentals" className="underline">
          {tSpaces("nav")}
        </Link>
      </div>
    );
  }

  const headerPx = 24 + 30;
  return (
    <TooltipProvider delay={150}>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {/* the strip: find a client, the conflicts, the legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" aria-hidden />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  goToStay(matches[0].id);
                }
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={t("timeline.search")}
              aria-label={t("timeline.search")}
              className="h-8 w-56 pl-8"
            />
            {query ? (
              <button
                type="button"
                aria-label={t("timeline.clearSearch")}
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          {q !== "" ? (
            <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
              {t("timeline.matches", { count: matches.length })}
            </span>
          ) : null}
          {summary.count > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:text-destructive h-7 gap-1.5"
              onClick={showFirstConflict}
            >
              <TriangleAlert className="size-3.5" aria-hidden />
              {t("timeline.conflictChip", { count: summary.count })}
              <span className="opacity-70">· {t("timeline.show")}</span>
            </Button>
          ) : null}
          <Legend className="ml-auto hidden md:flex" />
        </div>

        {/* The board: one scroller, both axes. The header sticks to its top
            and the rail to its left; `scroll-padding` keeps a focused cell
            clear of both. Sideways it is clipped to whole days once a scroll
            settles (onScroll), never mid-column. */}
        <div
          ref={scrollerRef}
          data-tl-scroller
          role="grid"
          aria-label={t("timeline.window")}
          aria-busy={isPending || undefined}
          aria-rowcount={laneOrder.length + 1}
          aria-colcount={cols}
          tabIndex={-1}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          {...stayDrag.handlers}
          style={{ scrollPaddingLeft: railPx, scrollPaddingTop: headerPx }}
          className={cn(
            "relative min-h-0 flex-1 overflow-auto overscroll-x-contain rounded-lg border outline-none",
            drag && "**:cursor-grabbing select-none",
          )}
        >
          <div className="relative" style={{ width: gridWidth }}>
            {/* header: the month strip, then one cell per day. Sticky so the
                dates stay put while the lanes scroll under them; dragging it
                pans the chart. */}
            <div
              {...headerDrag.handlers}
              className={cn("bg-background sticky top-0 z-30", headerDrag.dragging ? "cursor-grabbing select-none" : "cursor-grab")}
            >
              <div role="row" className="grid" style={{ gridTemplateColumns: columns }}>
                <div role="columnheader" aria-label={t("timeline.rail")} className="bg-background sticky left-0 z-40" />
                {bands.map((band) => (
                  <div
                    key={band.label}
                    role="columnheader"
                    className="border-border/60 flex h-6 items-end border-l pb-0.5 text-[13px] font-semibold first:border-l-0"
                    style={{ gridColumn: `${band.colStart + 2} / span ${band.colSpan}` }}
                  >
                    {/* sticky: a month that began off-screen keeps its name at the visible edge */}
                    <span className="sticky inline-block pl-2" style={{ left: railPx }}>
                      {band.label}
                    </span>
                  </div>
                ))}
              </div>
              <div role="row" className="border-border grid border-b" style={{ gridTemplateColumns: columns }}>
                <div role="columnheader" className="bg-background border-border sticky left-0 z-40 flex items-end border-r pb-1 pl-3">
                  {isPending ? (
                    <span className="text-muted-foreground text-[11px]" aria-hidden>
                      {t("timeline.loading")}
                    </span>
                  ) : null}
                </div>
                {bufferDays.map((d) => {
                  const isToday = today === d;
                  const label = showsDayNumber(d, density, today);
                  return (
                    <div
                      key={d}
                      role="columnheader"
                      className={cn("relative flex h-[30px] min-w-0 items-end justify-center overflow-hidden pb-1", columnClass(d, today), "bg-transparent")}
                    >
                      {/* the today marker: the line's head, on the header */}
                      {isToday ? (
                        <span
                          aria-hidden
                          className="bg-primary absolute bottom-0 h-1 w-1.5 rounded-t-sm"
                          style={{ left: `calc(${nowFrac * 100}% - 3px)` }}
                        />
                      ) : null}
                      {label ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Link
                                href={`/bookings?view=day&date=${d}${scopeSuffix}`}
                                aria-label={t("timeline.openDay", { date: cellDateLabel(d, intlLocale) })}
                                className={cn(
                                  "focus-visible:ring-ring flex items-baseline gap-1 rounded-md py-0.5 leading-none outline-none focus-visible:ring-2",
                                  density === "weekday" ? "px-1.5" : "px-1",
                                  isToday ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                                )}
                              >
                                {density === "weekday" ? (
                                  <span
                                    className={cn(
                                      "text-[10px]",
                                      isToday ? "text-primary-foreground/75" : isWeekend(d) ? "text-muted-foreground/60" : "text-muted-foreground",
                                    )}
                                  >
                                    {weekdays[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]}
                                  </span>
                                ) : null}
                                <span className={cn("text-xs font-semibold tabular-nums", !isToday && isWeekend(d) && "text-muted-foreground")}>
                                  {Number(d.slice(8, 10))}
                                </span>
                              </Link>
                            }
                          />
                          <TooltipContent>{t("timeline.openDay", { date: cellDateLabel(d, intlLocale) })}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* body: one grid per space. */}
            <div className="relative">
              {/* the today line: through every lane, at the hour it is now.
                  z-[5]: above the lanes' bars, below the sticky rail (z-20). */}
              {todayIdx >= 0 ? (
                <div
                  aria-hidden
                  className="bg-primary/70 pointer-events-none absolute inset-y-0 z-[5] w-0.5"
                  style={{ left: railPx + (todayIdx + nowFrac) * cellPx - 1 }}
                />
              ) : null}
              {offerings.map((offering) => {
                const conflictCount = perOffering.get(offering.id) ?? 0;
                const split = offering.units.length > 1;
                const isCollapsed = split && collapsed.has(offering.id);
                const counts = groupCounts.get(offering.id);
                return (
                  <div key={offering.id} role="rowgroup" className="grid" style={{ gridTemplateColumns: columns }}>
                    {split ? (
                      <div role="row" className="contents">
                        <div
                          role="rowheader"
                          // opaque: cells scrolled under a sticky rail must not show through
                          className="bg-muted border-border/60 sticky left-0 z-20 flex items-center gap-2 overflow-hidden border-b pr-3 pl-3"
                          style={{ height: GROUP_ROW_PX }}
                        >
                          <GroupLabel
                            offering={offering}
                            conflictCount={conflictCount}
                            collapsed={isCollapsed}
                            onToggle={() => toggleGroup(offering.id)}
                            compact={railPx < 200}
                          />
                        </div>
                        {bufferDays.map((d, i) => {
                          const n = counts?.[i] ?? 0;
                          const free = offering.rangeMode !== "hours";
                          return (
                            <div
                              key={d}
                              role="gridcell"
                              aria-label={free ? t("timeline.freeOn", { count: n, date: cellDateLabel(d, intlLocale) }) : t("timeline.bookedOn", { count: n, date: cellDateLabel(d, intlLocale) })}
                              className={cn(
                                "bg-muted/40 border-border/60 flex items-center justify-center border-b text-[11px] tabular-nums",
                                columnClass(d, today),
                                free ? (n === 0 ? "text-destructive font-medium" : "text-muted-foreground") : n === 0 ? "text-transparent" : "text-muted-foreground",
                              )}
                              style={{ height: GROUP_ROW_PX }}
                            >
                              {cellPx >= 20 ? n : ""}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {isCollapsed
                      ? null
                      : offering.units.map((unit) => (
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
                            railPx={railPx}
                            today={today}
                            now={now}
                            stays={lanes.get(unit.id) ?? []}
                            ghostIds={ghostsByUnit.get(unit.id)}
                            blackouts={blackoutsByUnit.get(unit.id) ?? []}
                            conflicts={conflicts}
                            conflictCount={conflictCount}
                            spotlightId={spotlightId}
                            onSpotlightEnd={() => setSpotlightId(null)}
                            scopeSuffix={scopeSuffix}
                            headerless={!split}
                            query={query}
                            focusIdx={
                              focusCell ? (focusCell.unitId === unit.id ? focusCell.idx : -1) : laneOrder[0] === unit.id ? visIdx : -1
                            }
                            onCellFocus={(idx) => setFocusCell({ unitId: unit.id, idx })}
                            drag={drag}
                            ghost={ghost}
                            onBarPress={(e, booking, edge) =>
                              stayDrag.begin(e, { booking, mode: offering.rangeMode, offeringId: offering.id, unitId: unit.id, edge })
                            }
                            pendingId={pendingMove?.id ?? null}
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

        <Legend className="flex md:hidden" />
        <div aria-live="polite" className="sr-only">
          {announce}
        </div>

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
            initial={{ kind: "space", offeringId: newStay.offeringId, unitId: newStay.unitId, date: newStay.date, endDate: newStay.endDate }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function Legend({ className }: { className?: string }) {
  const t = useTranslations("bookings");
  return (
    <ul className={cn("text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]", className)} aria-label={t("timeline.legend")}>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="bg-card border-l-primary inline-block h-3 w-5 rounded-sm border border-l-[3px]" />
        {t("timeline.stay")}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="bg-card inline-block h-3 w-5 rounded-sm border border-dashed" />
        {t("timeline.request")}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="border-border bg-muted/50 inline-block h-3 w-5 rounded-sm border"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)" }}
        />
        {t("timeline.unavailable")}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="border-muted-foreground/40 bg-muted/40 inline-block h-3 w-5 rounded-r-sm border border-l-0 border-dashed" />
        {t("timeline.turnover")}
      </li>
      <li className="flex items-center gap-1.5">
        <TriangleAlert className="text-destructive size-3" aria-hidden />
        {t("timeline.conflict")}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="bg-primary inline-block h-3 w-0.5" />
        {t("timeline.now")}
      </li>
      <li>{t("timeline.dragHint")}</li>
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

/* The collapsed set, in localStorage, as an external store: `set` notifies
   this tab's listeners (a storage event only reaches OTHER tabs). */
const listeners = new Set<() => void>();
const collapsedStore = {
  get(): string {
    try {
      return localStorage.getItem(COLLAPSED_KEY) ?? "[]";
    } catch {
      return "[]";
    }
  },
  set(value: string) {
    try {
      localStorage.setItem(COLLAPSED_KEY, value);
    } catch {
      // No storage: the toggle still shows for this render via the listeners' re-read.
    }
    for (const l of listeners) l();
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
};
function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
