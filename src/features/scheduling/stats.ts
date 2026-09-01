import { mondayOf } from "./calendar-geometry";
import { addDaysISO, dateInZone } from "./slots";

// Pure Overview aggregation. All boundaries in the org timezone; weeks are
// Mon–Sun to match the admin calendar. Feed it bookings whose starts_at falls
// inside the selected org-tz year (listStatsBookings with both bounds). The
// former stat tiles (computeOverviewStats) were dropped with the Linear
// overview redesign — git history has them.
export type StatsBookingRow = {
  startsAt: string;
  status: string;
  createdAt: string;
};

/** One grid cell; null = padding day outside the selected year. */
export type HeatmapDay = {
  date: string;
  confirmed: number;
  /** Live requests only — a pending booking whose day is already past is a
      stale record, not something the owner can still act on. */
  pending: number;
  /** 0 = no confirmed bookings; 1–4 scaled against the year's busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
} | null;

export type YearHeatmap = {
  /** Mon–Sun columns, oldest first, GitHub-contribution style. */
  weeks: HeatmapDay[][];
  confirmedTotal: number;
  pendingTotal: number;
};

/** Confirmed appointments and live pending requests per org-tz day over one
    calendar year. Edge columns are padded with nulls so week columns stay
    aligned Mon–Sun. */
export function buildYearHeatmap(
  rows: StatsBookingRow[],
  year: number,
  now: Date,
  timeZone: string,
): YearHeatmap {
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const todayISO = dateInZone(now, timeZone);

  const counts = new Map<string, { confirmed: number; pending: number }>();
  for (const b of rows) {
    const isPending = b.status === "pending";
    if (b.status !== "confirmed" && !isPending) continue;
    const day = dateInZone(new Date(b.startsAt), timeZone);
    if (isPending && day < todayISO) continue;
    const c = counts.get(day) ?? { confirmed: 0, pending: 0 };
    if (isPending) c.pending++;
    else c.confirmed++;
    counts.set(day, c);
  }

  // Max over in-year cells only — the caller's query is year-bounded, but the
  // function must not rely on that.
  let max = 0;
  let confirmedTotal = 0;
  let pendingTotal = 0;
  const weeks: HeatmapDay[][] = [];
  for (let colStart = mondayOf(jan1); colStart <= dec31; colStart = addDaysISO(colStart, 7)) {
    const week: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDaysISO(colStart, d);
      if (date < jan1 || date > dec31) {
        week.push(null);
        continue;
      }
      const c = counts.get(date) ?? { confirmed: 0, pending: 0 };
      if (c.confirmed > max) max = c.confirmed;
      confirmedTotal += c.confirmed;
      pendingTotal += c.pending;
      week.push({ date, ...c, level: 0 });
    }
    weeks.push(week);
  }
  for (const week of weeks)
    for (const day of week)
      if (day && day.confirmed > 0)
        day.level = Math.ceil((day.confirmed / max) * 4) as 1 | 2 | 3 | 4;
  return { weeks, confirmedTotal, pendingTotal };
}
