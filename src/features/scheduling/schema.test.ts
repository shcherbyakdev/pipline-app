import { describe, it, expect } from "vitest";
import {
  serviceInput,
  availabilityRuleInput,
  schedulingSettingsInput,
  getSlotsInput,
  createBookingInput,
  manageTokenInput,
  rescheduleBookingInput,
  adminSlotsInput,
  OVERLAP_ERROR,
  updateRuleInput,
  copyDayHoursInput,
  dateOverrideInput,
  deleteOverrideInput,
  staffInput,
  updateStaffInput,
  staffActiveInput,
} from "./schema";

describe("serviceInput", () => {
  it("accepts a minimal valid service", () => {
    const r = serviceInput.safeParse({ name: "Intro Call", durationMin: 30 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bufferBeforeMin).toBe(0);
      expect(r.data.bookingWindowDays).toBe(60);
      expect(r.data.active).toBe(true);
      expect(r.data.maxPerDay).toBeNull();
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

describe("schedulingSettingsInput handle clearing", () => {
  it("maps empty and whitespace handle to null", () => {
    expect(schedulingSettingsInput.parse({ handle: "", timezone: "UTC" }).handle).toBeNull();
    expect(schedulingSettingsInput.parse({ handle: "  ", timezone: "UTC" }).handle).toBeNull();
  });
  it("still rejects a malformed non-empty handle", () => {
    expect(schedulingSettingsInput.safeParse({ handle: "Bad Handle!", timezone: "UTC" }).success).toBe(false);
  });
  it("passes a valid handle through", () => {
    expect(schedulingSettingsInput.parse({ handle: "my-studio", timezone: "UTC" }).handle).toBe("my-studio");
  });
});

describe("lifecycle inputs", () => {
  it("manageTokenInput bounds token length", () => {
    expect(manageTokenInput.safeParse({ token: "short" }).success).toBe(false);
    expect(manageTokenInput.safeParse({ token: "x".repeat(43) }).success).toBe(true);
  });
  it("rescheduleBookingInput requires an ISO instant", () => {
    expect(
      rescheduleBookingInput.safeParse({ token: "x".repeat(43), startsAt: "tomorrow" }).success,
    ).toBe(false);
    expect(
      rescheduleBookingInput.safeParse({ token: "x".repeat(43), startsAt: "2027-04-05T10:00:00Z" }).success,
    ).toBe(true);
  });
  it("adminSlotsInput caps the scan window", () => {
    expect(
      adminSlotsInput.safeParse({ serviceId: crypto.randomUUID(), fromDate: "2027-04-05", days: 60 }).success,
    ).toBe(false);
  });
});

describe("updateRuleInput", () => {
  it("accepts an ordered window", () => {
    expect(
      updateRuleInput.safeParse({
        id: "6f6f38d4-7d33-4f0f-9d7e-51f6bd3c8a01",
        startTime: "09:00",
        endTime: "13:00",
      }).success,
    ).toBe(true);
  });
  it("rejects start >= end", () => {
    expect(
      updateRuleInput.safeParse({
        id: "6f6f38d4-7d33-4f0f-9d7e-51f6bd3c8a01",
        startTime: "13:00",
        endTime: "13:00",
      }).success,
    ).toBe(false);
  });
});

describe("copyDayHoursInput", () => {
  it("accepts distinct targets", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [2, 3] }).success).toBe(true);
  });
  it("rejects copying onto itself", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [1] }).success).toBe(false);
  });
  it("rejects duplicates and empty targets", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [2, 2] }).success).toBe(false);
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [] }).success).toBe(false);
  });
});

describe("dateOverrideInput", () => {
  it("accepts closed with no windows", () => {
    expect(dateOverrideInput.safeParse({ date: "2026-09-01", closed: true, windows: [] }).success).toBe(true);
  });
  it("accepts open with sorted touching windows", () => {
    expect(
      dateOverrideInput.safeParse({
        date: "2026-09-01",
        closed: false,
        windows: [
          { startTime: "09:00", endTime: "13:00" },
          { startTime: "13:00", endTime: "17:00" },
        ],
      }).success,
    ).toBe(true);
  });
  it("rejects open with no windows and closed with windows", () => {
    expect(dateOverrideInput.safeParse({ date: "2026-09-01", closed: false, windows: [] }).success).toBe(false);
    expect(
      dateOverrideInput.safeParse({
        date: "2026-09-01",
        closed: true,
        windows: [{ startTime: "09:00", endTime: "10:00" }],
      }).success,
    ).toBe(false);
  });
  it("rejects overlapping windows with the shared message", () => {
    const result = dateOverrideInput.safeParse({
      date: "2026-09-01",
      closed: false,
      windows: [
        { startTime: "09:00", endTime: "13:00" },
        { startTime: "12:00", endTime: "14:00" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === OVERLAP_ERROR)).toBe(true);
    }
  });
});

describe("deleteOverrideInput", () => {
  it("accepts a date and rejects garbage", () => {
    expect(deleteOverrideInput.safeParse({ date: "2026-09-01" }).success).toBe(true);
    expect(deleteOverrideInput.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
});

describe("staffInput", () => {
  const base = { name: "Anna", slug: "anna", color: "#4f46e5", serviceIds: [] };

  it("accepts a slug-shaped link name and rejects one with a space", () => {
    expect(staffInput.safeParse(base).success).toBe(true);
    expect(staffInput.safeParse({ ...base, slug: "A b" }).success).toBe(false);
    // One character is under the DB CHECK's floor of two.
    expect(staffInput.safeParse({ ...base, slug: "a" }).success).toBe(false);
  });

  it("treats an untouched email field as absent, but still validates a typed one", () => {
    const empty = staffInput.safeParse({ ...base, email: "  " });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.email).toBeUndefined();
    expect(staffInput.safeParse({ ...base, email: "anna@example.com" }).success).toBe(true);
    expect(staffInput.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });

  it("requires a lowercase six-digit hex colour and uuid service ids", () => {
    expect(staffInput.safeParse({ ...base, color: "#fff" }).success).toBe(false);
    expect(staffInput.safeParse({ ...base, color: "#4F46E5" }).success).toBe(false);
    expect(staffInput.safeParse({ ...base, serviceIds: ["nope"] }).success).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(staffInput.safeParse({ ...base, name: "   " }).success).toBe(false);
  });
});

describe("updateStaffInput / staffActiveInput", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { name: "Anna", slug: "anna", color: "#4f46e5", serviceIds: [] };
  it("requires an id on update", () => {
    expect(updateStaffInput.safeParse(base).success).toBe(false);
    expect(updateStaffInput.safeParse({ ...base, id }).success).toBe(true);
  });
  it("takes an id plus a boolean", () => {
    expect(staffActiveInput.safeParse({ id, active: false }).success).toBe(true);
    expect(staffActiveInput.safeParse({ id, active: "no" }).success).toBe(false);
  });
});
