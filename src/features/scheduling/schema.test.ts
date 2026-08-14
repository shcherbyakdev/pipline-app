import { describe, it, expect } from "vitest";
import {
  serviceInput,
  availabilityRuleInput,
  availabilityExceptionInput,
  schedulingSettingsInput,
  getSlotsInput,
  createBookingInput,
} from "./schema";

describe("serviceInput", () => {
  it("accepts a minimal valid service", () => {
    const r = serviceInput.safeParse({ name: "Intro Call", durationMin: 30 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bufferBeforeMin).toBe(0);
      expect(r.data.bookingWindowDays).toBe(60);
      expect(r.data.active).toBe(true);
    }
  });
  it("rejects out-of-range duration and empty name", () => {
    expect(serviceInput.safeParse({ name: "", durationMin: 30 }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "X", durationMin: 3 }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "X", durationMin: 999 }).success).toBe(false);
  });
});

describe("availabilityRuleInput", () => {
  it("accepts weekday 0-6 with ordered HH:MM times", () => {
    expect(
      availabilityRuleInput.safeParse({ weekday: 1, startTime: "09:00", endTime: "17:00" }).success,
    ).toBe(true);
  });
  it("rejects weekday 7, bad format, inverted order", () => {
    expect(availabilityRuleInput.safeParse({ weekday: 7, startTime: "09:00", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: "9am", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: "17:00", endTime: "09:00" }).success).toBe(false);
  });
});

describe("availabilityExceptionInput", () => {
  it("accepts closed day and open window", () => {
    expect(availabilityExceptionInput.safeParse({ date: "2027-01-04", closed: true }).success).toBe(true);
    expect(
      availabilityExceptionInput.safeParse({
        date: "2027-01-04",
        closed: false,
        startTime: "10:00",
        endTime: "12:00",
      }).success,
    ).toBe(true);
  });
  it("rejects open exception without a window", () => {
    expect(availabilityExceptionInput.safeParse({ date: "2027-01-04", closed: false }).success).toBe(false);
  });
});

describe("schedulingSettingsInput", () => {
  it("accepts a valid handle + timezone", () => {
    expect(
      schedulingSettingsInput.safeParse({ handle: "demo-studio", timezone: "Europe/Berlin" }).success,
    ).toBe(true);
  });
  it("rejects bad handles", () => {
    for (const handle of ["ab", "-bad", "bad-", "Bad", "has space", "a".repeat(51)]) {
      expect(schedulingSettingsInput.safeParse({ handle, timezone: "UTC" }).success).toBe(false);
    }
  });
});

describe("public inputs", () => {
  it("getSlotsInput bounds the scan", () => {
    expect(
      getSlotsInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        fromDate: "2027-02-01",
        days: 7,
      }).success,
    ).toBe(true);
    expect(
      getSlotsInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        fromDate: "2027-02-01",
        days: 60,
      }).success,
    ).toBe(false);
  });
  it("createBookingInput validates email and trims name", () => {
    const r = createBookingInput.safeParse({
      handle: "demo-studio",
      serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      startsAt: "2027-03-01T10:00:00.000Z",
      name: "  Jamie  ",
      email: "jamie@example.com",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Jamie");
    expect(
      createBookingInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        startsAt: "2027-03-01T10:00:00.000Z",
        name: "Jamie",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });
});
