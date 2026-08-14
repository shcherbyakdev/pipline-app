// Pure slot engine — no DB, no clock reads. `now` is always injected
// (cadence.ts convention). All returned instants are UTC Dates; the UI
// renders them in the viewer's timezone.

export type SlotService = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
};
export type SlotRule = { weekday: number; startTime: string; endTime: string };
export type SlotException = {
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
};
export type BusyInterval = { startsAt: Date; endsAt: Date };
export type SlotInput = {
  service: SlotService;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: BusyInterval[];
  timeZone: string;
  now: Date;
  fromDate: string;
  days: number;
};

const MIN = 60_000;
const DAY = 86_400_000;

// What wall-clock (as a UTC-encoded ms value) does `instant` show in `timeZone`?
function wallClockOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
}

// Org-local wall time → UTC instant, without a tz library: guess UTC, read
// back the wall-clock the guess shows in the zone, correct by the diff.
// The second pass settles DST-transition days.
export function wallTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    utc += target - wallClockOf(new Date(utc), timeZone);
  }
  return new Date(utc);
}

export function dateInZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDaysISO(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + days * DAY).toISOString().slice(0, 10);
}

// The org-local date's weekday is a property of the date itself.
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function computeSlots(input: SlotInput): Date[] {
  const { service, rules, exceptions, busy, timeZone, now, fromDate, days } = input;
  const notBefore = now.getTime() + service.minNoticeMin * MIN;
  const notAfter = now.getTime() + service.bookingWindowDays * DAY;
  const blockMs =
    (service.bufferBeforeMin + service.durationMin + service.bufferAfterMin) * MIN;
  const slots: Date[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDaysISO(fromDate, i);
    const dayExceptions = exceptions.filter((e) => e.date === date);
    if (dayExceptions.some((e) => e.closed)) continue;

    if (service.maxPerDay !== null) {
      const bookedToday = busy.filter((b) => dateInZone(b.startsAt, timeZone) === date).length;
      if (bookedToday >= service.maxPerDay) continue;
    }

    const overrides = dayExceptions.filter((e) => !e.closed);
    const windows: Array<{ startTime: string; endTime: string }> =
      overrides.length > 0
        ? overrides.map((e) => ({ startTime: e.startTime!, endTime: e.endTime! }))
        : rules.filter((r) => r.weekday === weekdayOf(date));

    for (const w of windows) {
      const winStart = wallTimeToUtc(date, w.startTime, timeZone).getTime();
      const winEnd = wallTimeToUtc(date, w.endTime, timeZone).getTime();
      for (let t = winStart; t + blockMs <= winEnd; t += blockMs) {
        const start = t + service.bufferBeforeMin * MIN;
        const end = start + service.durationMin * MIN;
        if (start < notBefore || start > notAfter) continue;
        const padStart = start - service.bufferBeforeMin * MIN;
        const padEnd = end + service.bufferAfterMin * MIN;
        const blocked = busy.some(
          (b) => padStart < b.endsAt.getTime() && b.startsAt.getTime() < padEnd,
        );
        if (blocked) continue;
        slots.push(new Date(start));
      }
    }
  }
  return slots;
}
