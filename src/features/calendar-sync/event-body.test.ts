import { describe, it, expect } from "vitest";
import { buildEventBody, eventIdFor, type SyncBooking } from "./event-body";

const booking: SyncBooking = {
  id: "0b42f6d0-1234-4abc-9def-0123456789ab",
  orgId: "org-1",
  status: "confirmed",
  staffId: "staff-1",
  rentalUnitId: null,
  startsAt: "2026-09-06T08:00:00+00:00",
  endsAt: "2026-09-06T09:00:00+00:00",
  clientName: "Anna Kowalska",
  clientEmail: "anna@example.com",
  note: "Back pain, second visit",
  title: "Massage 60",
  timeZone: "Europe/Warsaw",
};

describe("eventIdFor", () => {
  it("is the booking uuid without dashes (base32hex-safe)", () => {
    expect(eventIdFor(booking.id)).toBe("0b42f6d012344abc9def0123456789ab");
    expect(eventIdFor(booking.id)).toMatch(/^[0-9a-v]{5,1024}$/);
  });
});

describe("buildEventBody", () => {
  it("names the event after the client and the service, in the org's zone, marked as ours", () => {
    const body = buildEventBody(booking, "https://app.test");
    expect(body.id).toBe("0b42f6d012344abc9def0123456789ab");
    expect(body.summary).toBe("Anna Kowalska — Massage 60");
    expect(body.start).toEqual({ dateTime: "2026-09-06T08:00:00.000Z", timeZone: "Europe/Warsaw" });
    expect(body.end).toEqual({ dateTime: "2026-09-06T09:00:00.000Z", timeZone: "Europe/Warsaw" });
    expect(body.extendedProperties).toEqual({ private: { bookloBookingId: booking.id } });
    expect(body.reminders).toEqual({ useDefault: true });
    expect(body.description).toBe(
      ["anna@example.com", "Back pain, second visit", "", "Booked through Booklo", "https://app.test/bookings?date=2026-09-06"].join("\n"),
    );
  });

  it("adds the client as a guest only when asked, and only with an email", () => {
    const withGuest = buildEventBody(booking, "https://app.test", { inviteClient: true });
    expect(withGuest.attendees).toEqual([{ email: "anna@example.com", displayName: "Anna Kowalska" }]);
    expect(withGuest.guestsCanInviteOthers).toBe(false);
    expect(withGuest.guestsCanSeeOtherGuests).toBe(false);
    expect(buildEventBody(booking, "https://app.test").attendees).toBeUndefined();
    expect(buildEventBody({ ...booking, clientEmail: null }, "https://app.test", { inviteClient: true }).attendees).toBeUndefined();
  });

  it("leaves out what the booking does not have and dates the link in the org's zone", () => {
    const body = buildEventBody(
      { ...booking, clientEmail: null, note: null, startsAt: "2026-09-06T23:30:00Z", endsAt: "2026-09-07T00:30:00Z" },
      "https://app.test",
    );
    // 23:30Z is 01:30 the next day in Warsaw.
    expect(body.description).toBe(["Booked through Booklo", "https://app.test/bookings?date=2026-09-07"].join("\n"));
  });
});
