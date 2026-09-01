import { describe, it, expect } from "vitest";
import { buildYearHeatmap, type StatsBookingRow } from "./stats";

// 2027-03-10 is a Wednesday; Berlin is CET (UTC+1) until DST starts
// 2027-03-28. 2027-01-01 is a Friday, so the first grid column is padded
// with four null days (Mon 2026-12-28 .. Thu 2026-12-31).
const NOW = new Date("2027-03-10T12:00:00Z");
const TZ = "Europe/Berlin";

const row = (
  startsAt: string,
  status = "confirmed",
  createdAt = "2027-03-01T00:00:00Z",
): StatsBookingRow => ({ startsAt, status, createdAt });

describe("buildYearHeatmap", () => {
  const rows = [
    row("2027-03-09T23:30:00Z"), // 00:30 Berlin Mar 10 — tz bucketing
    row("2027-03-10T08:00:00Z"), // Mar 10 → confirmed 2 with the row above
    row("2027-03-08T10:00:00Z"), // Mar 8 → confirmed 1
    row("2027-03-08T12:00:00Z", "cancelled_by_client"), // ignored
    row("2027-03-10T18:00:00Z", "pending"), // today → still live
    row("2027-03-12T09:00:00Z", "pending"), // future request
    row("2027-02-01T09:00:00Z", "pending"), // past request → stale, dropped
    // In a padded (out-of-year) cell: must not count or scale anything.
    row("2026-12-30T10:00:00Z"),
    row("2026-12-30T11:00:00Z"),
    row("2026-12-30T12:00:00Z"),
  ];

  it("lays out one Mon–Sun column per week with null padding at the year edges", () => {
    const { weeks } = buildYearHeatmap(rows, 2027, NOW, TZ);
    expect(weeks).toHaveLength(53);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0][0]).toBeNull(); // Mon 2026-12-28
    expect(weeks[0][4]?.date).toBe("2027-01-01");
    expect(weeks[52][0]?.date).toBe("2027-12-27");
    expect(weeks[52][6]).toBeNull(); // Sun 2028-01-02
  });

  it("buckets by org-tz day, keeps only live pending, and scales in-year levels", () => {
    const { weeks, confirmedTotal, pendingTotal } = buildYearHeatmap(rows, 2027, NOW, TZ);
    // Column 10 is Mon 2027-03-08.
    expect(weeks[10][0]).toEqual({ date: "2027-03-08", confirmed: 1, pending: 0, level: 2 });
    expect(weeks[10][2]).toEqual({ date: "2027-03-10", confirmed: 2, pending: 1, level: 4 });
    expect(weeks[10][4]).toEqual({ date: "2027-03-12", confirmed: 0, pending: 1, level: 0 });
    expect(weeks[5][0]).toEqual({ date: "2027-02-01", confirmed: 0, pending: 0, level: 0 });
    expect(confirmedTotal).toBe(3); // the 2026-12-30 spike is outside the year
    expect(pendingTotal).toBe(2);
  });
});
