import { describe, it, expect } from "vitest";
import { bookingIcs } from "./ics";

const BASE = {
  uid: "11111111-2222-3333-4444-555555555555",
  starts: new Date("2027-03-01T10:00:00Z"),
  ends: new Date("2027-03-01T11:00:00Z"),
  summary: "Consultation — BookingCo",
  description: "Manage: https://example.com/booking/tok",
  url: "https://example.com/booking/tok",
};

describe("bookingIcs", () => {
  it("emits a well-formed UTC VEVENT with CRLF line ends", () => {
    const ics = bookingIcs(BASE);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20270301T100000Z");
    expect(ics).toContain("DTEND:20270301T110000Z");
    expect(ics).toContain(`UID:${BASE.uid}`);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });

  it("appends the staff member to SUMMARY only when staffName is given", () => {
    expect(bookingIcs({ ...BASE, staffName: "Anna" })).toContain(
      `SUMMARY:${BASE.summary} with Anna`,
    );
    // solo orgs pass null/undefined and get the pre-team SUMMARY byte-for-byte
    expect(bookingIcs({ ...BASE, staffName: null })).toBe(bookingIcs(BASE));
    expect(bookingIcs(BASE)).toContain(`SUMMARY:${BASE.summary}`);
    expect(bookingIcs(BASE)).not.toContain(" with ");
  });

  it("escapes commas, semicolons and newlines in text fields", () => {
    const ics = bookingIcs({ ...BASE, summary: "A, B; C\nD" });
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\nD");
  });
});
