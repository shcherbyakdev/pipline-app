"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AdminBooking, RuleRow, ExceptionRow, ServiceRow } from "@/features/scheduling/queries";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  zonedParts, hourRange, closedIntervals, serviceAccent, snap15, minToTime,
} from "@/features/scheduling/calendar-geometry";
import { addDaysISO } from "@/features/scheduling/slots";
import { blockTimeRange, reopenDay } from "@/features/scheduling/actions";
import { Button } from "@/components/ui/button";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { CreateBookingDialog } from "./create-booking-dialog";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 6px, var(--border) 6px, var(--border) 7px)",
};

export function CalendarWeek({
  weekStart, timeZone, bookings, rules, exceptions, services,
}: {
  weekStart: string;
  timeZone: string;
  bookings: AdminBooking[];
  rules: RuleRow[];
  exceptions: ExceptionRow[];
  services: ServiceRow[];
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const windowsByDay = days.map((d) => effectiveWindows(d, rules, exceptions));
  const { startHour, endHour } = hourRange(windowsByDay);
  const totalMin = (endHour - startHour) * 60;
  const pct = (min: number) => ((min - startHour * 60) / totalMin) * 100;

  // Now-line: client clock, re-evaluated every minute. Seeded in useEffect so
  // server and first client render match (no hydration mismatch).
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
  const nowParts = now ? zonedParts(now, timeZone) : null;

  const [selected, setSelected] = React.useState<AdminBooking | null>(null);

  const router = useRouter();
  const [busy, startBusy] = React.useTransition();
  type Selection = { date: string; startMin: number; endMin: number };
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const dayHasExceptions = (d: string) => exceptions.some((e) => e.date === d);

  // Escape clears an in-progress or pending selection. Event-driven state
  // change (inside the keydown callback, not the effect body directly) —
  // same idiom as command-menu.tsx's Cmd-K listener — so the
  // set-state-in-effect lint rule doesn't fire.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const blockSelected = () => {
    if (!selection) return;
    startBusy(async () => {
      const result = await blockTimeRange({
        date: selection.date,
        startTime: minToTime(selection.startMin),
        endTime: minToTime(selection.endMin),
      });
      if (!result.ok) toast.error(result.error);
      else toast.success("Time blocked.");
      setSelection(null);
      router.refresh();
    });
  };

  const reopenSelected = (date: string) => {
    startBusy(async () => {
      const result = await reopenDay({ date });
      if (!result.ok) toast.error(result.error);
      else toast.success("Day reopened — weekly hours restored.");
      setSelection(null);
      router.refresh();
    });
  };

  const byDay = (date: string) =>
    bookings.filter((b) => zonedParts(new Date(b.startsAt), timeZone).date === date);

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="grid min-w-[840px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        {/* header row */}
        <div className="sticky top-0 z-10 border-b bg-background" />
        {days.map((d, i) => (
          <div key={d} className="sticky top-0 z-10 border-b border-l bg-background p-2 text-center text-sm">
            <span className="text-muted-foreground">{DAY_LABELS[(i + 1) % 7]}</span>{" "}
            <span className={nowParts?.date === d ? "rounded bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground" : "font-medium"}>
              {Number(d.slice(8, 10))}
            </span>
          </div>
        ))}
        {/* gutter */}
        <div className="relative" style={{ height: `${(endHour - startHour) * 48}px` }}>
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div key={i} className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground"
              style={{ top: `${pct((startHour + i) * 60)}%` }}>
              {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>
        {/* day columns */}
        {days.map((d, di) => (
          <div
            key={d}
            className="relative border-l"
            style={{ height: `${(endHour - startHour) * 48}px` }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return; // cards handle themselves
              // Capture on the column itself so drag-move keeps firing here
              // even if the pointer strays outside the column bounds —
              // avoids a stuck `dragging` from a pointerup that lands
              // elsewhere (chosen over a window pointerup listener).
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              const min = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin);
              setSelection({ date: d, startMin: min, endMin: min + 15 });
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragging || !selection || selection.date !== d) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const min = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin) + 15;
              setSelection({ ...selection, endMin: Math.max(min, selection.startMin + 15) });
            }}
            onPointerUp={() => setDragging(false)}
          >
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-border/50"
                style={{ top: `${pct((startHour + i) * 60)}%` }} />
            ))}
            {closedIntervals(windowsByDay[di], startHour, endHour).map((c, i) => (
              <div key={i} className="absolute inset-x-0 bg-muted/30" style={{ ...HATCH, top: `${pct(c.startMin)}%`, height: `${pct(c.endMin) - pct(c.startMin)}%` }} />
            ))}
            {nowParts?.date === d ? (
              <div className="absolute inset-x-0 z-20 border-t-2 border-primary" style={{ top: `${pct(nowParts.minutes)}%` }} />
            ) : null}
            {byDay(d).map((b) => {
              const s = zonedParts(new Date(b.startsAt), timeZone);
              const e = zonedParts(new Date(b.endsAt), timeZone);
              const endMin = e.date === d ? e.minutes : endHour * 60;
              const compact = endMin - s.minutes < 30;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b)}
                  className="absolute inset-x-1 z-10 overflow-hidden rounded border bg-card p-1 text-left text-xs shadow-sm hover:shadow"
                  style={{
                    top: `${pct(s.minutes)}%`,
                    height: `${Math.max(pct(endMin) - pct(s.minutes), 1.5)}%`,
                    borderLeft: `3px solid ${serviceAccent(b.serviceId)}`,
                  }}
                >
                  <span className="font-medium">{b.serviceName}</span>
                  {compact ? null : (
                    <span className="block truncate text-muted-foreground">{b.clientName}</span>
                  )}
                </button>
              );
            })}
            {selection?.date === d ? (
              <div
                className="absolute inset-x-1 z-20 rounded border border-primary bg-primary/10"
                style={{ top: `${pct(selection.startMin)}%`, height: `${pct(selection.endMin) - pct(selection.startMin)}%` }}
              >
                {!dragging ? (
                  <div className="absolute left-0 top-full z-30 mt-1 flex w-max flex-col gap-1 rounded-md border bg-popover p-2 text-sm shadow-md">
                    <span className="text-xs text-muted-foreground">
                      {minToTime(selection.startMin)}–{minToTime(selection.endMin)}
                    </span>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>New booking</Button>
                    <Button size="sm" variant="ghost" onClick={blockSelected} disabled={busy}>Block time</Button>
                    {dayHasExceptions(d) ? (
                      <Button size="sm" variant="ghost" onClick={() => reopenSelected(d)} disabled={busy}>
                        Reopen day (restore weekly hours)
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>Dismiss</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
      {selection ? (
        <CreateBookingDialog
          open={createOpen}
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setSelection(null); }}
          date={selection.date}
          startMin={selection.startMin}
          timeZone={timeZone}
          services={services}
          windows={windowsByDay[days.indexOf(selection.date)] ?? []}
        />
      ) : null}
    </div>
  );
}
