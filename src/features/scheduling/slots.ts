// Pure slot engine — no DB, no clock reads. `now` is always injected
// (cadence.ts convention). All returned instants are UTC Dates; the UI
// renders them in the viewer's timezone.

export type SlotService = {
  // Present on real services; absent in a few pure-engine tests. maxPerDay
  // counts THIS service's bookings (the field lives on the service form —
  // "3 consultations a day" — not on the person).
  id?: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
  // Hourly offerings (rentals H2): candidate starts advance by this grid
  // increment instead of the block length — a 2h session can start every
  // 30 min, not just every 2h.
  stepMin?: number;
  // Rentals turnover is cleanup BETWEEN bookings, not part of the sellable
  // window: when set, a candidate may END exactly at the window close, with
  // its after-buffer (turnover) overflowing past closing. Busy-side conflict
  // checks are absolute-time and unaffected — nothing can double-book.
  allowTailOverflow?: boolean;
};
export type SlotRule = { weekday: number; startTime: string; endTime: string };
export type SlotException = {
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
};
// An existing booking. Its own service's buffers (audit 2026-08-24: the
// engine used to pad only the CANDIDATE, so a fresh slot could start inside
// an existing booking's cleanup time) and its service, for max/day.
export type BusyInterval = {
  startsAt: Date;
  endsAt: Date;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  serviceId?: string;
};
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
  // A wall time inside a DST spring-forward gap has no fixed point, so the
  // loop oscillates between the two adjacent-offset candidates. Resolve
  // deterministically by shifting FORWARD across the gap (the conventional
  // treatment of nonexistent local times): take the later candidate. For
  // every existing wall time `other === utc` and this is a no-op.
  const other = utc + (target - wallClockOf(new Date(utc), timeZone));
  return new Date(Math.max(utc, other));
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
  // Hourly mode: candidate starts advance on the offering's increment grid
  // rather than by the whole block (a 2h session can start every 30 min).
  const stepMs = (service.stepMin ?? 0) * MIN || blockMs;
  // The fit check: normally the whole block (incl. after-buffer) must clear
  // the window, but rentals turnover may overflow past closing (see
  // allowTailOverflow doc above) — only the before-buffer + duration need fit.
  const fitMs = service.allowTailOverflow
    ? (service.bufferBeforeMin + service.durationMin) * MIN
    : blockMs;
  const slots: Date[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDaysISO(fromDate, i);
    const dayExceptions = exceptions.filter((e) => e.date === date);
    if (dayExceptions.some((e) => e.closed)) continue;

    if (service.maxPerDay !== null) {
      const bookedToday = busy.filter(
        (b) =>
          dateInZone(b.startsAt, timeZone) === date &&
          (!service.id || !b.serviceId || b.serviceId === service.id),
      ).length;
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
      for (let t = winStart; t + fitMs <= winEnd; t += stepMs) {
        const start = t + service.bufferBeforeMin * MIN;
        const end = start + service.durationMin * MIN;
        if (start < notBefore || start > notAfter) continue;
        const padStart = start - service.bufferBeforeMin * MIN;
        const padEnd = end + service.bufferAfterMin * MIN;
        // Two checks so each side's buffer is honoured against the OTHER
        // side's event (the gap between two bookings is the larger of A's
        // after-buffer and B's before-buffer, never their sum): the padded
        // candidate must clear the existing event, and the bare candidate
        // must clear the existing event's own padding.
        const blocked = busy.some((b) => {
          const bStart = b.startsAt.getTime();
          const bEnd = b.endsAt.getTime();
          const bPadStart = bStart - (b.bufferBeforeMin ?? 0) * MIN;
          const bPadEnd = bEnd + (b.bufferAfterMin ?? 0) * MIN;
          return (padStart < bEnd && bStart < padEnd) || (start < bPadEnd && bPadStart < end);
        });
        if (blocked) continue;
        slots.push(new Date(start));
      }
    }
  }
  return slots;
}

export type StaffSlots = { staffId: string; slots: Date[] };
// "Anyone available": one merged list for the picker. Which staff actually
// takes the booking is decided in the DB (pick_staff_for_slot) — staffIds
// here is display-only (and lets the widget say "3 people free").
export function unionSlots(perStaff: StaffSlots[]): Array<{ startsAt: Date; staffIds: string[] }> {
  const byMs = new Map<number, string[]>();
  for (const { staffId, slots } of perStaff) {
    for (const s of slots) {
      const ms = s.getTime();
      const ids = byMs.get(ms);
      if (ids) { if (!ids.includes(staffId)) ids.push(staffId); }
      else byMs.set(ms, [staffId]);
    }
  }
  return [...byMs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, staffIds]) => ({ startsAt: new Date(ms), staffIds }));
}
