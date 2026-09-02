"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { PublicOffering } from "@/lib/booking/public";
import { asEngineOffering, type RangeAvailability } from "@/features/rentals/range";
import { nextFreeStays, stayLengthOptions } from "@/features/rentals/next-free-stays";

const SHOW = 8;
// Org-local dates carry no zone: pin the formatter to UTC so the viewer's
// own timezone can never shift a day (range-picker.tsx's convention).
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

/* Next free stays (widget templates spec §8): pick how long, then the
   soonest windows of that length, one tap each — the hourly flow's
   "How long?" then times, for nights and days. "Later dates" moves the
   two-month window on; "Back to the soonest" returns to this month. */
export function NextFreeStays({
  offering, availability, loading, onPick, onLater, onSooner,
}: {
  offering: PublicOffering;
  availability: RangeAvailability | null;
  loading: boolean;
  onPick: (start: string, end: string) => void;
  onLater: () => void;
  onSooner: (() => void) | null;
}) {
  const [limit, setLimit] = React.useState(SHOW);
  const lengths = stayLengthOptions(offering);
  const [length, setLength] = React.useState(lengths[0] ?? 1);
  const stays = availability ? nextFreeStays(asEngineOffering(offering), availability, limit + 1, length) : [];
  const shown = stays.slice(0, limit);
  const unit = offering.rangeMode === "nights" ? "night" : "day";
  const plural = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col gap-3">
      {lengths.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">How many {unit}s?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Length of stay in ${unit}s`}>
            {lengths.map((n) => (
              <Button
                key={n}
                type="button"
                variant="outline"
                size="sm"
                role="radio"
                aria-checked={n === length}
                // wt-surface is declared after wt-primary in globals.css and
                // would paint the chosen pill transparent: one or the other.
                className={n === length ? "wt-primary" : "wt-surface"}
                onClick={() => {
                  setLength(n);
                  setLimit(SHOW);
                }}
              >
                {plural(n)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-sm">
        <span className="font-medium">Next free {plural(length)}.</span>{" "}
        <span className="text-muted-foreground">Tap one to book those dates.</span>
      </p>
      <div aria-live="polite" className={loading ? "flex flex-col gap-2 opacity-60 transition-opacity" : "flex flex-col gap-2"}>
        {loading && !availability ? (
          <p className="text-muted-foreground text-sm">Loading availability…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing free in this period — try later dates.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((s) => (
              <li key={s.start}>
                <button
                  type="button"
                  onClick={() => onPick(s.start, s.end)}
                  className="wt-surface flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-sm"
                >
                  <span className="font-medium">
                    {dayFmt.format(utcDate(s.start))} to {dayFmt.format(utcDate(s.end))}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{plural(s.length)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {stays.length > limit ? (
          <Button variant="outline" size="sm" className="wt-surface" onClick={() => setLimit((n) => n + SHOW)}>Show more</Button>
        ) : (
          <Button variant="outline" size="sm" className="wt-surface" onClick={onLater}>Later dates</Button>
        )}
        {onSooner ? (
          <button type="button" className="text-muted-foreground text-sm underline underline-offset-3" onClick={onSooner}>Back to the soonest</button>
        ) : null}
      </div>
    </div>
  );
}
