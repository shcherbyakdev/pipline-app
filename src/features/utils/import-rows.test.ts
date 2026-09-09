import { describe, it, expect } from "vitest";
import { parseBookingsCsv, type ImportContext } from "./import-rows";

const CTX: ImportContext = {
  timeZone: "Europe/Warsaw",
  spaces: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Room A", slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Whole studio", slotIncrementMin: 60, minDurationMin: 120, maxDurationMin: 480 },
  ],
};

const HEADER = "space,date,start,end,client_name,client_email,note,paid\n";
// The fixtures use fixed 2026-10 dates; pin "now" before them so the past-row
// rule never bites the other cases as the calendar moves on.
const NOW = new Date("2026-01-01T00:00:00Z");

describe("parseBookingsCsv (S8)", () => {
  it("turns a valid row into an org-local booking with a computed duration", () => {
    const out = parseBookingsCsv(HEADER + "Room A,2026-10-05,10:00,11:30,Anna Nowak,anna@example.com,paper backdrop,yes\n", CTX, NOW);
    expect(out.invalid).toEqual([]);
    expect(out.ready).toEqual([
      {
        row: 2,
        offeringId: CTX.spaces[0].id,
        startsAt: "2026-10-05T08:00:00.000Z", // 10:00 CEST
        durationMin: 90,
        name: "Anna Nowak",
        email: "anna@example.com",
        note: "paper backdrop",
        paid: true,
      },
    ]);
  });

  it("matches the space by name case-insensitively and defaults paid to yes, email and note to undefined", () => {
    const out = parseBookingsCsv("space,date,start,end,client_name\nroom a,2026-10-05,10:00,11:00,Jan\n", CTX, NOW);
    expect(out.invalid).toEqual([]);
    expect(out.ready[0]).toMatchObject({ offeringId: CTX.spaces[0].id, durationMin: 60, name: "Jan", paid: true });
    expect(out.ready[0].email).toBeUndefined();
    expect(out.ready[0].note).toBeUndefined();
  });

  it("reads paid as no for no/false/0", () => {
    const out = parseBookingsCsv(HEADER + "Room A,2026-10-05,10:00,11:00,Jan,,,no\nRoom A,2026-10-06,10:00,11:00,Jan,,,0\n", CTX, NOW);
    expect(out.ready.map((r) => r.paid)).toEqual([false, false]);
  });

  it("names every invalid row with its spreadsheet row number and keeps the valid ones", () => {
    const out = parseBookingsCsv(
      HEADER +
        "Room B,2026-10-05,10:00,11:00,Jan,,,\n" + // unknown space
        "Room A,2026-13-05,10:00,11:00,Jan,,,\n" + // bad date
        "Room A,2026-10-05,11:00,10:00,Jan,,,\n" + // end before start
        "Room A,2026-10-05,10:00,10:45,Jan,,,\n" + // 45 min: below min and off the 30-min grid
        "Whole studio,2026-10-05,10:00,19:00,Jan,,,\n" + // 540 min: over max 480
        "Room A,2026-10-05,10:00,11:00,,,,\n" + // no name
        "Room A,2026-10-05,10:00,11:00,Jan,not-an-email,,\n" + // bad email
        "Room A,2026-10-05,10:00,11:00,Jan,,,maybe\n" + // bad paid
        "Room A,2026-10-05,10:00,11:00,Jan,,,\n", // valid
      CTX,
      NOW,
    );
    expect(out.ready).toHaveLength(1);
    expect(out.ready[0].row).toBe(10);
    expect(out.invalid.map((i) => i.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.invalid[0].reason).toMatch(/space/i);
    expect(out.invalid[1].reason).toMatch(/date/i);
    expect(out.invalid[2].reason).toMatch(/end/i);
    expect(out.invalid[3].reason).toMatch(/duration/i);
    expect(out.invalid[4].reason).toMatch(/duration/i);
    expect(out.invalid[5].reason).toMatch(/name/i);
    expect(out.invalid[6].reason).toMatch(/email/i);
    expect(out.invalid[7].reason).toMatch(/paid/i);
  });

  it("refuses a file without the required columns, an empty file, or more than 500 rows", () => {
    expect(parseBookingsCsv("space,date\nRoom A,2026-10-05\n", CTX, NOW)).toEqual({
      ready: [],
      invalid: [{ row: 1, reason: expect.stringMatching(/columns/i) }],
    });
    expect(parseBookingsCsv(HEADER, CTX, NOW).invalid[0].reason).toMatch(/no data rows/i);
    const big = HEADER + Array.from({ length: 501 }, () => "Room A,2026-10-05,10:00,11:00,Jan,,,\n").join("");
    expect(parseBookingsCsv(big, CTX, NOW).invalid[0].reason).toMatch(/500/);
  });

  it("rejects a row that starts in the past at preview time (the RPC would refuse it with a generic error)", () => {
    const now = new Date("2026-10-05T09:30:00Z"); // 11:30 in Warsaw
    const out = parseBookingsCsv(
      HEADER + "Room A,2026-10-05,10:00,11:00,Late,,,\n" + "Room A,2026-10-05,12:00,13:00,Fine,,,\n",
      CTX,
      now,
    );
    expect(out.invalid).toEqual([{ row: 2, reason: expect.stringMatching(/past/i) }]);
    expect(out.ready.map((r) => r.name)).toEqual(["Fine"]);
  });

  it("strips a BOM and tolerates header case and surrounding spaces", () => {
    const out = parseBookingsCsv("﻿Space, Date ,Start,End,Client_Name\nRoom A,2026-10-05,10:00,11:00,Jan\n", CTX, NOW);
    expect(out.invalid).toEqual([]);
    expect(out.ready).toHaveLength(1);
  });
});
