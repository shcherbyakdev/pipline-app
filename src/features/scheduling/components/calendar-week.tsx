"use client";

import * as React from "react";
import type { AdminBooking, RuleRow, ExceptionRow, ServiceRow } from "@/features/scheduling/queries";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  zonedParts, hourRange, closedIntervals, serviceAccent,
} from "@/features/scheduling/calendar-geometry";
import { addDaysISO } from "@/features/scheduling/slots";
import { BookingDetailDialog } from "./booking-detail-dialog";

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
          <div key={d} className="relative border-l" style={{ height: `${(endHour - startHour) * 48}px` }}>
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
          </div>
        ))}
      </div>
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
