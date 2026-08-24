import { describe, it, expect } from "vitest";
import {
  formatWhenLine,
  bookingConfirmationEmail,
  staffNewBookingEmail,
  formatRangeWhenLine,
  formatHourlyWhenLine,
  whenLineFor,
  bookingLifecycleKey,
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingReminderEmail,
  bookingManageLinkEmail,
  providerCancelledEmail,
  providerRescheduledEmail,
} from "./templates";

describe("booking lifecycle templates", () => {
  it("lifecycle keys are stable per booking+kind", () => {
    expect(bookingLifecycleKey("b1", "reminder")).toBe("booking/b1/reminder");
    expect(bookingLifecycleKey("b1", "cancelled")).toBe("booking/b1/cancelled");
  });

  it("lifecycle key accepts a per-rotation manage kind", () => {
    expect(bookingLifecycleKey("b1", "manage-abcd1234")).toBe("booking/b1/manage-abcd1234");
  });

  it("cancellation copy differs by initiator", () => {
    const base = { orgName: "Studio", serviceName: "Cut", whenLine: "Mon, 05 Apr" };
    expect(bookingCancelledEmail({ ...base, cancelledBy: "client" }).text).toContain("as requested");
    expect(bookingCancelledEmail({ ...base, cancelledBy: "provider" }).text).toContain("had to cancel");
  });

  it("rescheduled email carries both times and the new manage link", () => {
    const msg = bookingRescheduledEmail({
      orgName: "Studio",
      serviceName: "Cut",
      oldWhenLine: "OLD-TIME",
      whenLine: "NEW-TIME",
      manageUrl: "https://app/booking/tok",
      icsUrl: "https://app/booking/tok/calendar.ics",
    });
    expect(msg.text).toContain("Was: OLD-TIME");
    expect(msg.text).toContain("Now: NEW-TIME");
    expect(msg.html).toContain("https://app/booking/tok");
  });

  it("reminder email contains no URL at all (token cannot be reconstructed)", () => {
    const msg = bookingReminderEmail({ orgName: "Studio", serviceName: "Cut", whenLine: "Mon" });
    expect(msg.html).not.toContain("http");
    expect(msg.text).not.toContain("http");
  });

  it("escapes HTML in interpolations", () => {
    const msg = providerCancelledEmail({
      serviceName: "<script>",
      whenLine: "Mon",
      clientName: "A & B",
    });
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("A &amp; B");
  });

  it("manage link email states the previous link is dead and carries the fresh one", () => {
    const msg = bookingManageLinkEmail({
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon, 05 Apr",
      manageUrl: "https://app/booking/fresh-tok",
      icsUrl: "https://app/booking/fresh-tok/calendar.ics",
    });
    expect(msg.subject).toContain("Cut");
    expect(msg.subject).toContain("Studio");
    expect(msg.text).toContain("no longer works");
    expect(msg.text).toContain("view, reschedule, or cancel");
    expect(msg.html).toContain("https://app/booking/fresh-tok");
    expect(msg.text).toContain("https://app/booking/fresh-tok");
  });

  it("manage link email drops 'reschedule' when the booking cannot be rescheduled (rentals)", () => {
    const base = {
      orgName: "Studio",
      serviceName: "Loft · 2B",
      whenLine: "Mon, 05 Apr → Thu, 08 Apr",
      manageUrl: "https://app/booking/fresh-tok",
      icsUrl: "https://app/booking/fresh-tok/calendar.ics",
    };
    const msg = bookingManageLinkEmail({ ...base, canReschedule: false });
    expect(msg.text).toContain("view or cancel");
    expect(msg.text).not.toContain("reschedule");
    expect(msg.html).not.toContain("reschedule");
    // default (omitted) keeps the appointment wording
    expect(bookingManageLinkEmail(base).text).toContain("view, reschedule, or cancel");
  });

  it("provider rescheduled email shows both times and escapes clientName", () => {
    const msg = providerRescheduledEmail({
      serviceName: "Cut",
      oldWhenLine: "OLD-TIME",
      whenLine: "NEW-TIME",
      clientName: "A & B",
    });
    expect(msg.text).toContain("Was: OLD-TIME");
    expect(msg.text).toContain("Now: NEW-TIME");
    expect(msg.html).toContain("A &amp; B");
  });

  it("client templates carry a 'With {staff}' line only when staffName is given", () => {
    const base = {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon, 05 Apr",
      manageUrl: "https://app/booking/tok",
      icsUrl: "https://app/booking/tok/calendar.ics",
    };
    const solo = bookingConfirmationEmail(base);
    expect(solo.text).not.toContain("With ");
    expect(solo.html).not.toContain("With ");

    const team = bookingConfirmationEmail({ ...base, staffName: "Anna" });
    expect(team.text).toContain("With Anna");
    expect(team.html).toContain("With Anna");
    // solo stays byte-identical to the pre-team output
    expect(bookingConfirmationEmail({ ...base, staffName: null })).toEqual(solo);
  });

  it("every client-facing template accepts staffName and escapes it", () => {
    const staffName = "A & B";
    expect(
      bookingRescheduledEmail({
        orgName: "Studio",
        serviceName: "Cut",
        oldWhenLine: "OLD",
        whenLine: "NEW",
        manageUrl: "https://app/booking/tok",
        icsUrl: "https://app/booking/tok/calendar.ics",
        staffName,
      }).html,
    ).toContain("With A &amp; B");
    expect(
      bookingCancelledEmail({
        orgName: "Studio",
        serviceName: "Cut",
        whenLine: "Mon",
        cancelledBy: "client",
        staffName,
      }).text,
    ).toContain("With A & B");
    expect(
      bookingReminderEmail({ orgName: "Studio", serviceName: "Cut", whenLine: "Mon", staffName }).text,
    ).toContain("With A & B");
    expect(
      bookingManageLinkEmail({
        orgName: "Studio",
        serviceName: "Cut",
        whenLine: "Mon",
        manageUrl: "https://app/booking/tok",
        icsUrl: "https://app/booking/tok/calendar.ics",
        staffName,
      }).text,
    ).toContain("With A & B");
  });

  it("staffNewBookingEmail names the client and the slot, link-free", () => {
    const msg = staffNewBookingEmail({
      staffName: "Anna",
      orgName: "Studio",
      serviceName: "Cut",
      clientName: "A & B",
      whenLine: "Mon, 05 Apr",
    });
    expect(msg.subject).toBe("New booking — Cut, Mon, 05 Apr");
    expect(msg.text).toContain("A & B");
    expect(msg.html).toContain("A &amp; B");
    expect(msg.text).toContain("Mon, 05 Apr");
    expect(msg.html).not.toContain("http");
  });

  it("formatRangeWhenLine renders both ends in the org zone with one tz suffix", () => {
    const s = formatRangeWhenLine(
      new Date("2027-09-10T13:00:00Z"),
      new Date("2027-09-13T09:00:00Z"),
      "Europe/Berlin",
    );
    expect(s).toBe("Fri, 10 Sept 2027, 15:00 → Mon, 13 Sept 2027, 11:00 (CEST)");
  });

  it("formatHourlyWhenLine prints the date once with an en-dash time range", () => {
    const s = formatHourlyWhenLine(
      new Date("2026-09-07T08:00:00Z"),
      new Date("2026-09-07T10:00:00Z"),
      "Europe/Warsaw",
    );
    expect(s).toBe("Mon, 07 Sept 2026, 10:00–12:00 (CEST)");
  });

  it("whenLineFor dispatches on isRental", () => {
    const b = { startsAt: new Date("2027-09-10T13:00:00Z"), endsAt: new Date("2027-09-13T09:00:00Z") };
    expect(whenLineFor({ ...b, isRental: false }, "Europe/Berlin")).toBe(
      formatWhenLine(b.startsAt, "Europe/Berlin"),
    );
    expect(whenLineFor({ ...b, isRental: true }, "Europe/Berlin")).toContain("→");
  });

  it("whenLineFor renders an hourly rental (rangeMode: 'hours') via formatHourlyWhenLine, not the nights/days range", () => {
    const b = { startsAt: new Date("2027-09-10T08:00:00Z"), endsAt: new Date("2027-09-10T10:00:00Z") };
    expect(whenLineFor({ ...b, isRental: true, rangeMode: "hours" }, "Europe/Berlin")).toBe(
      formatHourlyWhenLine(b.startsAt, b.endsAt, "Europe/Berlin"),
    );
    expect(whenLineFor({ ...b, isRental: true, rangeMode: "hours" }, "Europe/Berlin")).not.toContain("→");
    // A nights/days rental (or one that never passes rangeMode at all —
    // every pre-H2 caller) still gets the two-date range.
    expect(whenLineFor({ ...b, isRental: true, rangeMode: "nights" }, "Europe/Berlin")).toContain("→");
    expect(whenLineFor({ ...b, isRental: true }, "Europe/Berlin")).toContain("→");
  });
});

// "Powered by Booklo" (spec §5): the growth loop rides along on every
// client-facing email. The templates stay pure — the server decides whether
// the badge shows (plan + the org's toggle) and passes a URL, or null.
describe("email badge", () => {
  const BADGE_URL = "https://booklo.example/?ref=badge";
  const clientFacing = (badgeUrl?: string | null) => ({
    confirmation: bookingConfirmationEmail({
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    manageLink: bookingManageLinkEmail({
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    cancelled: bookingCancelledEmail({
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      cancelledBy: "client",
      badgeUrl,
    }),
    rescheduled: bookingRescheduledEmail({
      orgName: "Studio",
      serviceName: "Cut",
      oldWhenLine: "Sun",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    reminder: bookingReminderEmail({ orgName: "Studio", serviceName: "Cut", whenLine: "Mon", badgeUrl }),
  });

  it("renders on every client-facing email when a URL is given", () => {
    for (const [name, msg] of Object.entries(clientFacing(BADGE_URL))) {
      expect(msg.html, name).toContain(`<a href="${BADGE_URL}"`);
      expect(msg.html, name).toContain("Powered by Booklo");
      expect(msg.text, name).toContain(`Powered by Booklo — ${BADGE_URL}`);
      // Last line inside the wrapper, not appended after it.
      expect(msg.html.trimEnd().endsWith("</div>"), name).toBe(true);
    }
  });

  it("renders nothing when omitted or null", () => {
    for (const [name, msg] of Object.entries(clientFacing())) {
      expect(msg.html, name).not.toContain("Powered by Booklo");
      expect(msg.text, name).not.toContain("Powered by Booklo");
    }
    for (const [name, msg] of Object.entries(clientFacing(null))) {
      expect(msg.html, name).not.toContain("Powered by Booklo");
      expect(msg.text, name).not.toContain("Powered by Booklo");
    }
  });

  it("escapes the URL it is handed", () => {
    const msg = bookingReminderEmail({
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      badgeUrl: "https://booklo.example/?ref=badge&org=studio",
    });
    expect(msg.html).toContain("?ref=badge&amp;org=studio");
  });

  it("leaves staff-facing emails alone", () => {
    expect(
      providerCancelledEmail({ serviceName: "Cut", whenLine: "Mon", clientName: "A" }).html,
    ).not.toContain("Powered by Booklo");
    expect(
      staffNewBookingEmail({
        staffName: "Anna",
        orgName: "Studio",
        serviceName: "Cut",
        clientName: "A",
        whenLine: "Mon",
      }).html,
    ).not.toContain("Powered by Booklo");
  });
});
