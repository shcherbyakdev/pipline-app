import { describe, it, expect } from "vitest";
import { computeOverviewStats, type StatsBookingRow } from "./stats";

// 2027-03-10 is a Wednesday; Berlin is CET (UTC+1) until DST starts
// 2027-03-28. Week = Mon 03-08 .. Sun 03-14 → UTC [03-07T23:00, 03-14T23:00).
// Month = Mar → UTC [02-28T23:00, 03-31T22:00) (April 1 falls in CEST).
const NOW = new Date("2027-03-10T12:00:00Z");
const TZ = "Europe/Berlin";

const row = (
  startsAt: string,
  status = "confirmed",
  createdAt = "2027-03-01T00:00:00Z",
): StatsBookingRow => ({ startsAt, status, createdAt });

describe("computeOverviewStats", () => {
  it("counts confirmed bookings in the org-tz week and month, boundaries half-open", () => {
    const rows = [
      row("2027-03-07T23:00:00Z"), // Mon 00:00 Berlin — first instant of week
      row("2027-03-14T22:59:00Z"), // Sun 23:59 Berlin — last minute of week
      row("2027-03-14T23:00:00Z"), // next Mon 00:00 — out of week, in month
      row("2027-02-28T22:59:00Z"), // Feb 28 23:59 Berlin — out of month
      row("2027-03-31T21:59:00Z"), // Mar 31 23:59 CEST — in month, not week
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(2);
    expect(stats.monthCount).toBe(4);
  });

  it("only status=confirmed counts toward week/month", () => {
    const rows = [
      row("2027-03-10T09:00:00Z", "cancelled_by_client"),
      row("2027-03-10T10:00:00Z", "cancelled_by_provider"),
      row("2027-03-10T11:00:00Z", "rescheduled"),
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(0);
    expect(stats.monthCount).toBe(0);
  });

  it("cancellation rate = cancelled / (created-in-30d minus rescheduled)", () => {
    const rows = [
      row("2027-03-11T09:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T10:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T11:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T12:00:00Z", "cancelled_by_client", "2027-03-05T00:00:00Z"),
      // rescheduled rows are neutral — their replacement already counts
      row("2027-03-11T13:00:00Z", "rescheduled", "2027-03-05T00:00:00Z"),
      // created before the 30-day window — ignored entirely
      row("2027-03-11T14:00:00Z", "cancelled_by_provider", "2027-01-01T00:00:00Z"),
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.cancellationRate).toBe(0.25);
  });

  it("cancellation rate is null with no bookings created in the window", () => {
    const rows = [row("2027-03-11T09:00:00Z", "confirmed", "2027-01-01T00:00:00Z")];
    expect(computeOverviewStats(rows, NOW, TZ).cancellationRate).toBeNull();
  });

  it("busiest weekday and hour are independent modes over past-90d confirmed bookings", () => {
    const rows = [
      row("2027-03-02T09:00:00Z"), // Tue 10:00 Berlin
      row("2027-03-09T09:00:00Z"), // Tue 10:00 Berlin
      row("2027-03-03T08:00:00Z"), // Wed 09:00 Berlin
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBe("Tue");
    expect(stats.busiestHour).toBe(10);
  });

  it("ties break to the earlier weekday (Mon-first) and earlier hour", () => {
    const rows = [
      row("2027-03-02T13:00:00Z"), // Tue 14:00 Berlin
      row("2027-03-01T09:00:00Z"), // Mon 10:00 Berlin
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBe("Mon");
    expect(stats.busiestHour).toBe(10);
  });

  it("future bookings count toward the week but not toward busiest", () => {
    const rows = [row("2027-03-12T09:00:00Z")]; // Friday — after NOW (Wed)
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(1);
    expect(stats.busiestWeekday).toBeNull();
    expect(stats.busiestHour).toBeNull();
  });

  it("bookings older than 90 days are excluded from busiest", () => {
    const rows = [row("2026-12-01T10:00:00Z")];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBeNull();
  });

  it("buckets busiest-hour by the DST-local wall clock", () => {
    // DST started 2027-03-28; 08:00Z on Mon 03-29 is 10:00 CEST.
    const now = new Date("2027-04-01T12:00:00Z");
    const rows = [row("2027-03-29T08:00:00Z", "confirmed", "2027-03-20T00:00:00Z")];
    const stats = computeOverviewStats(rows, now, TZ);
    expect(stats.busiestWeekday).toBe("Mon");
    expect(stats.busiestHour).toBe(10);
  });

  it("December month window rolls into January", () => {
    const now = new Date("2026-12-15T12:00:00Z");
    const rows = [
      row("2026-12-31T23:30:00Z", "confirmed", "2026-12-01T00:00:00Z"),
      row("2027-01-01T00:30:00Z", "confirmed", "2026-12-01T00:00:00Z"),
    ];
    expect(computeOverviewStats(rows, now, "UTC").monthCount).toBe(1);
  });

  it("pending and declined rows never count — not as bookings, not in cancellation rate", () => {
    const rows = [
      row("2027-03-10T09:00:00Z", "pending"),
      row("2027-03-10T10:00:00Z", "declined"),
      row("2027-03-10T11:00:00Z", "confirmed"),
      row("2027-03-10T12:00:00Z", "cancelled_by_client"),
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(1);
    // eligible = confirmed + cancelled only -> rate 1/2, not 1/4
    expect(stats.cancellationRate).toBe(0.5);
  });

  it("empty input yields zero counts and null rates", () => {
    const stats = computeOverviewStats([], NOW, TZ);
    expect(stats).toEqual({
      weekCount: 0,
      monthCount: 0,
      prevWeekCount: 0,
      prevMonthCount: 0,
      cancellationRate: null,
      busiestWeekday: null,
      busiestHour: null,
    });
  });
});
