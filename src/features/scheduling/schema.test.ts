import { describe, it, expect } from "vitest";
import {
  serviceInput,
  updateServiceInput,
  patchServiceInput,
  availabilityRuleInput,
  blockTimeInput,
  reopenDayInput,
  schedulingSettingsInput,
  getSlotsInput,
  createBookingInput,
  normalizePhone,
  manageTokenInput,
  rescheduleBookingInput,
  adminSlotsInput,
  adminCreateBookingInput,
  adminRescheduleInput,
  OVERLAP_ERROR,
  updateRuleInput,
  copyDayHoursInput,
  dateOverrideInput,
  deleteOverrideInput,
  staffInput,
  updateStaffInput,
  staffActiveInput,
  STAFF_SLUG_RESERVED_ISSUE,
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
  // Team (multi-staff): the eligibility checklist is optional on the wire —
  // omitted means "the dialog didn't ask" (solo org), and createService then
  // assigns every active member server-side rather than nobody.
  it("leaves staffIds undefined when the dialog omits it", () => {
    const r = serviceInput.safeParse({ name: "Intro Call", durationMin: 30 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.staffIds).toBeUndefined();
  });
  it("accepts a staffIds list of uuids, including an empty one", () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const r = serviceInput.safeParse({ name: "X", durationMin: 30, staffIds: ids });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.staffIds).toEqual(ids);
    expect(serviceInput.safeParse({ name: "X", durationMin: 30, staffIds: [] }).success).toBe(true);
  });
  it("rejects staffIds that are not uuids", () => {
    expect(
      serviceInput.safeParse({ name: "X", durationMin: 30, staffIds: ["nope"] }).success,
    ).toBe(false);
    expect(
      serviceInput.safeParse({ name: "X", durationMin: 30, staffIds: "not-an-array" }).success,
    ).toBe(false);
  });
});

describe("updateServiceInput", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  it("takes the settings alone", () => {
    const r = updateServiceInput.safeParse({ id, durationMin: 30 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bookingWindowDays).toBe(60);
  });
  it("refuses identity and roster — the header and pills own those", () => {
    expect(updateServiceInput.safeParse({ id, durationMin: 30, name: "X" }).success).toBe(false);
    expect(updateServiceInput.safeParse({ id, durationMin: 30, description: "X" }).success).toBe(false);
    expect(
      updateServiceInput.safeParse({
        id,
        durationMin: 30,
        staffIds: ["11111111-1111-4111-8111-111111111111"],
      }).success,
    ).toBe(false);
  });
});

describe("patchServiceInput", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  it("leaves an absent field alone and clears description with an empty string", () => {
    const r = patchServiceInput.safeParse({ id, description: "  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.description).toBeNull();
      expect(r.data.name).toBeUndefined();
      expect(r.data.staffIds).toBeUndefined();
    }
  });
  it("takes an empty roster as a deliberate nobody, but never an empty name", () => {
    expect(patchServiceInput.safeParse({ id, staffIds: [] }).success).toBe(true);
    expect(patchServiceInput.safeParse({ id, name: "  " }).success).toBe(false);
  });
});

describe("availabilityRuleInput", () => {
  const staffId = "22222222-2222-4222-8222-222222222222";
  const rentalOfferingId = "33333333-3333-4333-8333-333333333333";
  it("accepts weekday 0-6 with ordered HH:MM times", () => {
    expect(
      availabilityRuleInput.safeParse({ staffId, weekday: 1, startTime: "09:00", endTime: "17:00" })
        .success,
    ).toBe(true);
  });
  it("rejects weekday 7, bad format, inverted order", () => {
    expect(availabilityRuleInput.safeParse({ staffId, weekday: 7, startTime: "09:00", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ staffId, weekday: 1, startTime: "9am", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ staffId, weekday: 1, startTime: "17:00", endTime: "09:00" }).success).toBe(false);
  });
  it("rejects a malformed staffId", () => {
    expect(
      availabilityRuleInput.safeParse({ staffId: "nope", weekday: 1, startTime: "09:00", endTime: "17:00" })
        .success,
    ).toBe(false);
  });
  // H2: a rule belongs to a staff member XOR an hours rental offering — the
  // owner id is exactly one of the two, never both, never neither.
  it("accepts an offering-owned rule", () => {
    expect(
      availabilityRuleInput.safeParse({
        rentalOfferingId,
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      }).success,
    ).toBe(true);
  });
  it("rejects both owner ids at once", () => {
    expect(
      availabilityRuleInput.safeParse({
        staffId,
        rentalOfferingId,
        weekday: 1,
        startTime: "09:00",
        endTime: "17:00",
      }).success,
    ).toBe(false);
  });
  it("rejects neither owner id", () => {
    expect(
      availabilityRuleInput.safeParse({ weekday: 1, startTime: "09:00", endTime: "17:00" }).success,
    ).toBe(false);
  });
});

describe("schedulingSettingsInput", () => {
  it("accepts a valid handle + timezone", () => {
    expect(
      schedulingSettingsInput.safeParse({ handle: "demo-studio", timezone: "Europe/Berlin", currency: "PLN", locale: "en" })
        .success,
    ).toBe(true);
  });
  it("rejects bad handles", () => {
    for (const handle of ["ab", "-bad", "bad-", "Bad", "has space", "a".repeat(51)]) {
      expect(schedulingSettingsInput.safeParse({ handle, timezone: "UTC", currency: "PLN", locale: "en" }).success).toBe(false);
    }
  });
  it("rejects a reserved handle", () => {
    expect(
      schedulingSettingsInput.safeParse({ handle: "login", timezone: "Europe/Warsaw", currency: "PLN", locale: "en" }).success,
    ).toBe(false);
    expect(
      schedulingSettingsInput.safeParse({ handle: "anna", timezone: "Europe/Warsaw", currency: "PLN", locale: "en" }).success,
    ).toBe(true);
  });
  it("scheduling settings require a whitelisted currency", () => {
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "PLN", locale: "en" }).success).toBe(true);
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "JPY", locale: "en" }).success).toBe(false);
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw" }).success).toBe(false);
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "PLN", locale: "uk" }).success).toBe(true);
    // The org locale is one the product speaks (LOCALES), never a bare format check.
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "PLN", locale: "ua" }).success).toBe(false);
    expect(schedulingSettingsInput.safeParse({ handle: "my-org", timezone: "Europe/Warsaw", currency: "PLN" }).success).toBe(false);
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
  it("createBookingInput takes either contact and leaves requiring one to the RPC (0086)", () => {
    const base = {
      handle: "demo-studio",
      serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      startsAt: "2027-03-01T10:00:00.000Z",
      name: "Jamie",
    };
    // An untouched field arrives as "" and reads as "not given".
    const r = createBookingInput.safeParse({ ...base, email: "", phone: " +48 600-123 456 " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ email: undefined, phone: "+48 600-123 456" });
    expect(createBookingInput.safeParse({ ...base, email: "", phone: "" }).success).toBe(true);
    for (const phone of ["12", "abc", "+48 600 123 456 ext 9", "(22) 123 45 67"]) {
      expect(createBookingInput.safeParse({ ...base, phone }).success, phone).toBe(false);
    }
  });
  it("normalizePhone is the TS twin of the SQL stored form", () => {
    expect(normalizePhone(" +48 600-123 456 ")).toBe("+48600123456");
    expect(normalizePhone("600 123 456")).toBe("600123456");
    for (const bad of ["", null, "1 - -", "+48+600", "1".repeat(21)]) expect(normalizePhone(bad), String(bad)).toBeNull();
  });
});

describe("schedulingSettingsInput handle clearing", () => {
  it("maps empty and whitespace handle to null", () => {
    expect(schedulingSettingsInput.parse({ handle: "", timezone: "UTC", currency: "PLN", locale: "en" }).handle).toBeNull();
    expect(schedulingSettingsInput.parse({ handle: "  ", timezone: "UTC", currency: "PLN", locale: "en" }).handle).toBeNull();
  });
  it("still rejects a malformed non-empty handle", () => {
    expect(
      schedulingSettingsInput.safeParse({ handle: "Bad Handle!", timezone: "UTC", currency: "PLN", locale: "en" }).success,
    ).toBe(false);
  });
  it("passes a valid handle through", () => {
    expect(
      schedulingSettingsInput.parse({ handle: "my-studio", timezone: "UTC", currency: "PLN", locale: "en" }).handle,
    ).toBe("my-studio");
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
      adminSlotsInput.safeParse({
        serviceId: crypto.randomUUID(),
        staffId: crypto.randomUUID(),
        fromDate: "2027-04-05",
        days: 60,
      }).success,
    ).toBe(false);
  });
  // Team (multi-staff): the admin slot grid is one person's grid — there is no
  // "any" here (the walk-in dialog always names someone), so the id is
  // required rather than defaulted like the public `staffChoice`.
  it("adminSlotsInput requires a staff id", () => {
    const base = { serviceId: crypto.randomUUID(), fromDate: "2027-04-05", days: 7 };
    expect(adminSlotsInput.safeParse(base).success).toBe(false);
    expect(adminSlotsInput.safeParse({ ...base, staffId: "nobody" }).success).toBe(false);
    expect(adminSlotsInput.safeParse({ ...base, staffId: crypto.randomUUID() }).success).toBe(true);
  });
  it("adminCreateBookingInput requires a staff id", () => {
    const base = {
      serviceId: crypto.randomUUID(),
      startsAt: "2027-04-05T10:00:00Z",
      name: "Walk-in",
    };
    expect(adminCreateBookingInput.safeParse(base).success).toBe(false);
    expect(
      adminCreateBookingInput.safeParse({ ...base, staffId: crypto.randomUUID() }).success,
    ).toBe(true);
  });
  // …and on a move it is OPTIONAL: omitted means "same person, new time",
  // which is the only thing this dialog could do before the team slice.
  it("adminRescheduleInput takes an optional staff id", () => {
    const base = { id: crypto.randomUUID(), startsAt: "2027-04-05T10:00:00Z" };
    const kept = adminRescheduleInput.safeParse(base);
    expect(kept.success).toBe(true);
    if (kept.success) expect(kept.data.staffId).toBeUndefined();
    expect(adminRescheduleInput.safeParse({ ...base, staffId: crypto.randomUUID() }).success).toBe(
      true,
    );
    expect(adminRescheduleInput.safeParse({ ...base, staffId: "someone" }).success).toBe(false);
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
  const staffId = "22222222-2222-4222-8222-222222222222";
  const rentalOfferingId = "33333333-3333-4333-8333-333333333333";
  it("accepts distinct targets", () => {
    expect(copyDayHoursInput.safeParse({ staffId, sourceWeekday: 1, targetWeekdays: [2, 3] }).success).toBe(true);
  });
  it("rejects copying onto itself", () => {
    expect(copyDayHoursInput.safeParse({ staffId, sourceWeekday: 1, targetWeekdays: [1] }).success).toBe(false);
  });
  it("rejects duplicates and empty targets", () => {
    expect(copyDayHoursInput.safeParse({ staffId, sourceWeekday: 1, targetWeekdays: [2, 2] }).success).toBe(false);
    expect(copyDayHoursInput.safeParse({ staffId, sourceWeekday: 1, targetWeekdays: [] }).success).toBe(false);
  });
  it("accepts an offering owner", () => {
    expect(
      copyDayHoursInput.safeParse({ rentalOfferingId, sourceWeekday: 1, targetWeekdays: [2] }).success,
    ).toBe(true);
  });
  it("requires exactly one owner id — a copy is within one owner's week", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [2] }).success).toBe(false);
    expect(
      copyDayHoursInput.safeParse({ staffId, rentalOfferingId, sourceWeekday: 1, targetWeekdays: [2] })
        .success,
    ).toBe(false);
  });
});

describe("dateOverrideInput", () => {
  const staffId = "22222222-2222-4222-8222-222222222222";
  const rentalOfferingId = "33333333-3333-4333-8333-333333333333";
  it("accepts closed with no windows", () => {
    expect(dateOverrideInput.safeParse({ staffId, date: "2026-09-01", closed: true, windows: [] }).success).toBe(true);
  });
  it("accepts open with sorted touching windows", () => {
    expect(
      dateOverrideInput.safeParse({
        staffId,
        date: "2026-09-01",
        closed: false,
        windows: [
          { startTime: "09:00", endTime: "13:00" },
          { startTime: "13:00", endTime: "17:00" },
        ],
      }).success,
    ).toBe(true);
  });
  it("accepts an offering owner", () => {
    expect(
      dateOverrideInput.safeParse({ rentalOfferingId, date: "2026-09-01", closed: true, windows: [] })
        .success,
    ).toBe(true);
  });
  it("requires exactly one owner id — an override belongs to one owner's calendar", () => {
    expect(dateOverrideInput.safeParse({ date: "2026-09-01", closed: true, windows: [] }).success).toBe(false);
    expect(
      dateOverrideInput.safeParse({
        staffId,
        rentalOfferingId,
        date: "2026-09-01",
        closed: true,
        windows: [],
      }).success,
    ).toBe(false);
  });
  it("rejects open with no windows and closed with windows", () => {
    expect(dateOverrideInput.safeParse({ staffId, date: "2026-09-01", closed: false, windows: [] }).success).toBe(false);
    expect(
      dateOverrideInput.safeParse({
        staffId,
        date: "2026-09-01",
        closed: true,
        windows: [{ startTime: "09:00", endTime: "10:00" }],
      }).success,
    ).toBe(false);
  });
  it("rejects overlapping windows with the shared message", () => {
    const result = dateOverrideInput.safeParse({
      staffId,
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
  const staffId = "22222222-2222-4222-8222-222222222222";
  const rentalOfferingId = "33333333-3333-4333-8333-333333333333";
  it("accepts a staff id + date and rejects garbage", () => {
    expect(deleteOverrideInput.safeParse({ staffId, date: "2026-09-01" }).success).toBe(true);
    expect(deleteOverrideInput.safeParse({ staffId, date: "not-a-date" }).success).toBe(false);
    expect(deleteOverrideInput.safeParse({ date: "2026-09-01" }).success).toBe(false);
  });
  it("accepts an offering owner and rejects both owner ids", () => {
    expect(deleteOverrideInput.safeParse({ rentalOfferingId, date: "2026-09-01" }).success).toBe(true);
    expect(
      deleteOverrideInput.safeParse({ staffId, rentalOfferingId, date: "2026-09-01" }).success,
    ).toBe(false);
  });
});

// blockTimeRange/unblockTimeRange are calendar-only surfaces (spec: H2 task
// 6) — blockTimeInput stays staff-only, never offering-owned.
describe("blockTimeInput", () => {
  const staffId = "22222222-2222-4222-8222-222222222222";
  it("carries the staff whose day is being edited", () => {
    expect(
      blockTimeInput.safeParse({ staffId, date: "2026-09-01", startTime: "09:00", endTime: "10:00" }).success,
    ).toBe(true);
    expect(
      blockTimeInput.safeParse({ date: "2026-09-01", startTime: "09:00", endTime: "10:00" }).success,
    ).toBe(false);
  });
});

// reopenDay IS owner-generalized (spec: H2 task 6) even though the only
// caller today (calendar-week.tsx) is staff-only.
describe("reopenDayInput", () => {
  const staffId = "22222222-2222-4222-8222-222222222222";
  const rentalOfferingId = "33333333-3333-4333-8333-333333333333";
  it("accepts either owner and rejects both/neither", () => {
    expect(reopenDayInput.safeParse({ staffId, date: "2026-09-01" }).success).toBe(true);
    expect(reopenDayInput.safeParse({ rentalOfferingId, date: "2026-09-01" }).success).toBe(true);
    expect(reopenDayInput.safeParse({ date: "2026-09-01" }).success).toBe(false);
    expect(
      reopenDayInput.safeParse({ staffId, rentalOfferingId, date: "2026-09-01" }).success,
    ).toBe(false);
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

  it("staffInput refuses a reserved slug with the reserved issue (spec 2026-08-28 §3.3)", () => {
    const base = { name: "X", slug: "spaces", color: "#4f46e5", serviceIds: [] };
    const result = staffInput.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === "slug" && i.message === STAFF_SLUG_RESERVED_ISSUE)).toBe(true);
    expect(staffInput.safeParse({ ...base, slug: "spaces-1" }).success).toBe(true);
  });
});

describe("updateStaffInput / staffActiveInput", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = { name: "Anna", slug: "anna", color: "#4f46e5", serviceIds: [] };
  it("requires an id on update", () => {
    expect(updateStaffInput.safeParse(base).success).toBe(false);
    expect(updateStaffInput.safeParse({ ...base, id }).success).toBe(true);
  });
  it("takes a partial row; an emptied email clears it, an absent one is left alone", () => {
    expect(updateStaffInput.safeParse({ id, name: "Anna" }).success).toBe(true);
    expect(updateStaffInput.parse({ id, email: " " }).email).toBeNull();
    expect(updateStaffInput.parse({ id, name: "Anna" }).email).toBeUndefined();
    expect(updateStaffInput.parse({ id, email: "Anna@Example.com" }).email).toBe("anna@example.com");
    // The slug rules survive the partial: a reserved word is still refused.
    expect(updateStaffInput.safeParse({ id, slug: "spaces" }).success).toBe(false);
  });
  it("takes an id plus a boolean", () => {
    expect(staffActiveInput.safeParse({ id, active: false }).success).toBe(true);
    expect(staffActiveInput.safeParse({ id, active: "no" }).success).toBe(false);
  });
});
