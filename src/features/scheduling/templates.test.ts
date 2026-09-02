import { describe, it, expect } from "vitest";
import { enTranslator, translatorFor } from "@/i18n/test-translator";

const T = enTranslator("emails");
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
  providerNewBookingEmail,
  bookingRequestReceivedEmail,
  bookingDeclinedEmail,
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
    expect(bookingCancelledEmail(T, { ...base, cancelledBy: "client" }).text).toContain("as requested");
    expect(bookingCancelledEmail(T, { ...base, cancelledBy: "provider" }).text).toContain("had to cancel");
  });

  it("rescheduled email carries both times and the new manage link", () => {
    const msg = bookingRescheduledEmail(T, {
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
    const msg = bookingReminderEmail(T, { orgName: "Studio", serviceName: "Cut", whenLine: "Mon" });
    expect(msg.html).not.toContain("http");
    expect(msg.text).not.toContain("http");
  });

  it("escapes HTML in interpolations", () => {
    const msg = providerCancelledEmail(T, {
      serviceName: "<script>",
      whenLine: "Mon",
      clientName: "A & B",
    });
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("A &amp; B");
  });

  it("manage link email states the previous link is dead and carries the fresh one", () => {
    const msg = bookingManageLinkEmail(T, {
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
    const msg = bookingManageLinkEmail(T, { ...base, canReschedule: false });
    expect(msg.text).toContain("view or cancel");
    expect(msg.text).not.toContain("reschedule");
    expect(msg.html).not.toContain("reschedule");
    // default (omitted) keeps the appointment wording
    expect(bookingManageLinkEmail(T, base).text).toContain("view, reschedule, or cancel");
  });

  it("manage link email for a pending request says request and drops the .ics", () => {
    const base = {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon, 05 Apr, 10:00",
      manageUrl: "https://app/booking/fresh-tok",
      icsUrl: "https://app/booking/fresh-tok/calendar.ics",
    };
    const msg = bookingManageLinkEmail(T, { ...base, request: true });
    expect(msg.subject.startsWith("Your request link")).toBe(true);
    for (const body of [msg.html, msg.text]) {
      expect(body).toContain("view or withdraw");
      expect(body).toContain("booking request");
      // Nothing is on a calendar until the request is accepted.
      expect(body).not.toContain(".ics");
      expect(body).not.toContain("Add to calendar");
      expect(body).toContain("https://app/booking/fresh-tok");
    }
    // Unset: a confirmed booking still gets its subject, wording and .ics.
    const plain = bookingManageLinkEmail(T, base);
    expect(plain.subject.startsWith("Your booking link")).toBe(true);
    expect(plain.text).toContain("your booking (");
    expect(plain.html).toContain("Add to calendar (.ics)");
    expect(plain.text).toContain("Add to calendar: https://app/booking/fresh-tok/calendar.ics");
  });

  it("provider rescheduled email shows both times and escapes clientName", () => {
    const msg = providerRescheduledEmail(T, {
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
    const solo = bookingConfirmationEmail(T, base);
    expect(solo.text).not.toContain("With ");
    expect(solo.html).not.toContain("With ");

    const team = bookingConfirmationEmail(T, { ...base, staffName: "Anna" });
    expect(team.text).toContain("With Anna");
    expect(team.html).toContain("With Anna");
    // solo stays byte-identical to the pre-team output
    expect(bookingConfirmationEmail(T, { ...base, staffName: null })).toEqual(solo);
  });

  it("every client-facing template accepts staffName and escapes it", () => {
    const staffName = "A & B";
    expect(
      bookingRescheduledEmail(T, {
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
      bookingCancelledEmail(T, {
        orgName: "Studio",
        serviceName: "Cut",
        whenLine: "Mon",
        cancelledBy: "client",
        staffName,
      }).text,
    ).toContain("With A & B");
    expect(
      bookingReminderEmail(T, { orgName: "Studio", serviceName: "Cut", whenLine: "Mon", staffName }).text,
    ).toContain("With A & B");
    expect(
      bookingManageLinkEmail(T, {
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
    const msg = staffNewBookingEmail(T, {
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

  it("client and provider copy never says appointment or slot (H5b: spaces book too)", () => {
    const base = { orgName: "Studio", serviceName: "Loft · 2B", whenLine: "Mon, 05 Apr → Thu, 08 Apr" };
    const manageUrl = "https://app/booking/tok";
    const icsUrl = "https://app/booking/tok/calendar.ics";
    // Every exported template body — not just the client/provider four the
    // original loop covered — so a future edit that leaks "appointment" or
    // "slot" into any of them is caught here.
    const mails = [
      bookingConfirmationEmail(T, { ...base, manageUrl, icsUrl }),
      bookingManageLinkEmail(T, { ...base, manageUrl, icsUrl }), // default canReschedule
      bookingCancelledEmail(T, { ...base, cancelledBy: "client" }),
      bookingCancelledEmail(T, { ...base, cancelledBy: "provider" }),
      bookingRescheduledEmail(T, { ...base, oldWhenLine: "Mon, 05 Apr → Thu, 08 Apr", manageUrl, icsUrl }),
      bookingReminderEmail(T, base),
      staffNewBookingEmail(T, { staffName: "Anna", clientName: "A", ...base }),
      providerNewBookingEmail(T, {
        serviceName: base.serviceName,
        clientName: "A",
        clientEmail: "a@example.com",
        whenLine: base.whenLine,
      }),
      providerCancelledEmail(T, { serviceName: "Loft", whenLine: "Mon", clientName: "A" }),
      providerRescheduledEmail(T, { serviceName: "Loft", oldWhenLine: "Mon", whenLine: "Tue", clientName: "A" }),
    ];
    for (const m of mails) {
      expect(m.text.toLowerCase()).not.toMatch(/appointment|\bslot\b/);
      expect(m.html.toLowerCase()).not.toMatch(/appointment|\bslot\b/);
    }
    expect(bookingReminderEmail(T, base).text).toContain("A reminder about your upcoming booking.");
    expect(bookingCancelledEmail(T, { ...base, cancelledBy: "client" }).html).toContain(
      "Want to rebook? You can book again any time on the booking page.",
    );
    expect(providerCancelledEmail(T, { serviceName: "Loft", whenLine: "Mon", clientName: "A" }).text).toContain(
      "The time is open again.",
    );
  });
});

// "Powered by Booklo" (spec §5): the growth loop rides along on every
// client-facing email. The templates stay pure — the server decides whether
// the badge shows (plan + the org's toggle) and passes a URL, or null.
describe("email badge", () => {
  const BADGE_URL = "https://booklo.example/?ref=badge";
  const clientFacing = (badgeUrl?: string | null) => ({
    confirmation: bookingConfirmationEmail(T, {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    manageLink: bookingManageLinkEmail(T, {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    cancelled: bookingCancelledEmail(T, {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      cancelledBy: "client",
      badgeUrl,
    }),
    rescheduled: bookingRescheduledEmail(T, {
      orgName: "Studio",
      serviceName: "Cut",
      oldWhenLine: "Sun",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      badgeUrl,
    }),
    reminder: bookingReminderEmail(T, { orgName: "Studio", serviceName: "Cut", whenLine: "Mon", badgeUrl }),
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
    const msg = bookingReminderEmail(T, {
      orgName: "Studio",
      serviceName: "Cut",
      whenLine: "Mon",
      badgeUrl: "https://booklo.example/?ref=badge&org=studio",
    });
    expect(msg.html).toContain("?ref=badge&amp;org=studio");
  });

  it("leaves staff-facing emails alone", () => {
    expect(
      providerCancelledEmail(T, { serviceName: "Cut", whenLine: "Mon", clientName: "A" }).html,
    ).not.toContain("Powered by Booklo");
    expect(
      staffNewBookingEmail(T, {
        staffName: "Anna",
        orgName: "Studio",
        serviceName: "Cut",
        clientName: "A",
        whenLine: "Mon",
      }).html,
    ).not.toContain("Powered by Booklo");
  });
});

// H3: money + policy lines on confirmations (Task 8). infoLines is an
// optional pass-through — absent/empty must render byte-identical to the
// pre-H3 templates (the omission tests below depend on that).
describe("H3 money/policy infoLines", () => {
  it("bookingConfirmationEmail renders infoLines in html and text", () => {
    const msg = bookingConfirmationEmail(T, {
      orgName: "Org",
      serviceName: "Studio · Room 1",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
      infoLines: ["Total: 300 zł", "Payment: pay at the venue"],
    });
    expect(msg.html).toContain("Total: 300 zł");
    expect(msg.text).toContain("Payment: pay at the venue");
  });

  it("omits the block when infoLines is absent", () => {
    const msg = bookingConfirmationEmail(T, {
      orgName: "Org",
      serviceName: "S",
      whenLine: "Mon",
      manageUrl: "https://x/m",
      icsUrl: "https://x/i",
    });
    expect(msg.html).not.toContain("Total:");
  });

  it("providerNewBookingEmail renders infoLines in html and text", () => {
    const msg = providerNewBookingEmail(T, {
      serviceName: "Studio · Room 1",
      clientName: "A",
      clientEmail: "a@example.com",
      whenLine: "Mon",
      infoLines: ["Total: 300 zł", "Payment: pay at the venue"],
    });
    expect(msg.html).toContain("Total: 300 zł");
    expect(msg.text).toContain("Payment: pay at the venue");
  });

  it("providerNewBookingEmail omits the block when infoLines is absent", () => {
    const msg = providerNewBookingEmail(T, {
      serviceName: "S",
      clientName: "A",
      clientEmail: "a@example.com",
      whenLine: "Mon",
    });
    expect(msg.html).not.toContain("Total:");
    expect(msg.text).not.toContain("Total:");
  });
});

describe("Ukrainian mails (i18n Wave 2, spec D4)", () => {
  const U = translatorFor("uk", "emails");
  const base = { orgName: "Студія Анна", serviceName: "Стрижка", whenLine: "чт, 03 вер. 2026 р., 10:00 GMT+2" };
  const links = { manageUrl: "https://x.test/booking/t", icsUrl: "https://x.test/booking/t/calendar.ics" };
  const mails = [
    bookingConfirmationEmail(U, { ...base, ...links, staffName: "Олена", badgeUrl: "https://x.test/?ref=badge" }),
    bookingManageLinkEmail(U, { ...base, ...links }),
    bookingManageLinkEmail(U, { ...base, ...links, canReschedule: false }),
    bookingManageLinkEmail(U, { ...base, ...links, request: true }),
    bookingCancelledEmail(U, { ...base, cancelledBy: "client" }),
    bookingCancelledEmail(U, { ...base, cancelledBy: "provider" }),
    bookingRequestReceivedEmail(U, { ...base, manageUrl: links.manageUrl }),
    bookingDeclinedEmail(U, { ...base, note: "Вибачте, зайнято" }),
    bookingRescheduledEmail(U, { ...base, ...links, oldWhenLine: "ср, 02 вер. 2026 р., 10:00 GMT+2" }),
    bookingReminderEmail(U, base),
    staffNewBookingEmail(U, { ...base, staffName: "Олена", clientName: "Іван" }),
    providerNewBookingEmail(U, { ...base, clientName: "Іван", clientEmail: "ivan@example.com" }),
    providerNewBookingEmail(U, { ...base, clientName: "Іван", clientEmail: "ivan@example.com", pending: true }),
    providerCancelledEmail(U, { ...base, clientName: "Іван" }),
    providerRescheduledEmail(U, { ...base, clientName: "Іван", oldWhenLine: "ср, 02 вер. 2026 р., 10:00 GMT+2" }),
  ];

  it("every mail reads Ukrainian end to end — no English sentence survives outside URLs and names", () => {
    for (const m of mails) {
      const body = `${m.subject}\n${m.text}\n${m.html.replace(/<[^>]+>/g, " ")}`
        .replace(/https?:\/\/\S+/g, "")
        .replace(/ivan@example\.com|Booklo|GMT\+2/g, "");
      expect(body, m.subject).toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
      expect(body, m.subject).not.toMatch(/\b(booking|your|with|the|link|calendar|request|cancelled|reminder)\b/i);
      // H5b's rule in Ukrainian: spaces book too, so never "запис" (appointment) or "слот".
      expect(body.toLowerCase(), m.subject).not.toMatch(/слот|\bзапис\b/);
    }
  });

  it("client names stay bold in html and plain in text through t.markup", () => {
    const m = providerCancelledEmail(U, { ...base, clientName: "Іван <b>" });
    expect(m.html).toContain("<strong>Іван &lt;b&gt;</strong> скасував(ла) бронювання.");
    expect(m.text).toContain("Іван <b> скасував(ла) бронювання.");
    // Org names are mostly feminine or neuter: the verb agrees with «Заклад», never with the name.
    expect(bookingCancelledEmail(U, { ...base, cancelledBy: "provider" }).text).toContain("Заклад Студія Анна мусив скасувати");
  });
});
