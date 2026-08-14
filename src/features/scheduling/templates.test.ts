import { describe, it, expect } from "vitest";
import {
  bookingLifecycleKey,
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingReminderEmail,
  providerCancelledEmail,
  providerRescheduledEmail,
} from "./templates";

describe("booking lifecycle templates", () => {
  it("lifecycle keys are stable per booking+kind", () => {
    expect(bookingLifecycleKey("b1", "reminder")).toBe("booking/b1/reminder");
    expect(bookingLifecycleKey("b1", "cancelled")).toBe("booking/b1/cancelled");
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
});
