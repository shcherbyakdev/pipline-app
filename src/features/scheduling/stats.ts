import { mondayOf } from "./calendar-geometry";
import { addDaysISO, dateInZone, wallTimeToUtc } from "./slots";

// Pure overview-stat aggregation (S5). All boundaries in the org timezone;
// weeks are Mon–Sun to match the admin calendar. Feed it bookings with
// starts_at >= now - 90d: both booking RPCs floor starts_at at now - 24h at
// insert time, so that one window also contains every booking created in the
// last 30 days (the cancellation-rate basis).
export type StatsBookingRow = {
  startsAt: string;
  status: string;
  createdAt: string;
};

export type OverviewStats = {
  weekCount: number;
  monthCount: number;
  /** cancelled / (created-in-30d minus rescheduled); null when no denominator. */
  cancellationRate: number | null;
  /** en short weekday name in the org tz ("Tue"); null when no past-90d history. */
  busiestWeekday: string | null;
  /** 0-23 org-tz start hour; null when no past-90d history. */
  busiestHour: number | null;
};

const DAY_MS = 86_400_000;
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isCancelled(status: string): boolean {
  return status === "cancelled_by_client" || status === "cancelled_by_provider";
}

function nextMonthFirstISO(todayISO: string): string {
  const year = Number(todayISO.slice(0, 4));
  const month = Number(todayISO.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function computeOverviewStats(
  rows: StatsBookingRow[],
  now: Date,
  timeZone: string,
): OverviewStats {
  const todayISO = dateInZone(now, timeZone);
  const weekStartISO = mondayOf(todayISO);
  const weekFrom = wallTimeToUtc(weekStartISO, "00:00", timeZone).getTime();
  const weekTo = wallTimeToUtc(addDaysISO(weekStartISO, 7), "00:00", timeZone).getTime();
  const monthFrom = wallTimeToUtc(`${todayISO.slice(0, 7)}-01`, "00:00", timeZone).getTime();
  const monthTo = wallTimeToUtc(nextMonthFirstISO(todayISO), "00:00", timeZone).getTime();

  let weekCount = 0;
  let monthCount = 0;
  for (const b of rows) {
    if (b.status !== "confirmed") continue;
    const t = Date.parse(b.startsAt);
    if (t >= weekFrom && t < weekTo) weekCount++;
    if (t >= monthFrom && t < monthTo) monthCount++;
  }

  const createdFrom = now.getTime() - 30 * DAY_MS;
  let cancelled = 0;
  let eligible = 0;
  for (const b of rows) {
    if (Date.parse(b.createdAt) < createdFrom) continue;
    if (b.status === "rescheduled") continue; // the replacement booking already counts
    eligible++;
    if (isCancelled(b.status)) cancelled++;
  }
  const cancellationRate = eligible === 0 ? null : cancelled / eligible;

  // Busiest = independent modes over history only (no future bookings).
  const historyFrom = now.getTime() - 90 * DAY_MS;
  const nowMs = now.getTime();
  const weekdayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  });
  for (const b of rows) {
    if (b.status !== "confirmed") continue;
    const t = Date.parse(b.startsAt);
    if (t < historyFrom || t > nowMs) continue;
    let weekday = "";
    let hour = -1;
    for (const part of fmt.formatToParts(new Date(t))) {
      if (part.type === "weekday") weekday = part.value;
      if (part.type === "hour") hour = Number(part.value);
    }
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }

  let busiestWeekday: string | null = null;
  for (const day of WEEKDAY_ORDER) {
    const count = weekdayCounts.get(day) ?? 0;
    if (count > 0 && count > (busiestWeekday === null ? 0 : weekdayCounts.get(busiestWeekday)!)) {
      busiestWeekday = day;
    }
  }
  let busiestHour: number | null = null;
  for (let h = 0; h < 24; h++) {
    const count = hourCounts.get(h) ?? 0;
    if (count > 0 && count > (busiestHour === null ? 0 : hourCounts.get(busiestHour)!)) {
      busiestHour = h;
    }
  }

  return { weekCount, monthCount, cancellationRate, busiestWeekday, busiestHour };
}
