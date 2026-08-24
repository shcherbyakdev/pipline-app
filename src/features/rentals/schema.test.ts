import { describe, it, expect } from "vitest";
import {
  offeringInput,
  unitInput,
  blackoutInput,
  getRangeAvailabilityInput,
  createRentalBookingInput,
  adminRangeAvailabilityInput,
  rescheduleRentalAdminInput,
  createRentalAdminInput,
  manageRangeAvailabilityInput,
  rescheduleRentalInput,
} from "./schema";

const base = { name: "Studio", rangeMode: "nights", startTime: "15:00", endTime: "11:00" };

describe("offeringInput", () => {
  it("applies defaults", () => {
    const r = offeringInput.parse(base);
    expect(r).toMatchObject({ minStay: 1, maxStay: null, turnoverDays: 0, minNoticeDays: 0, bookingWindowDays: 180, unitSelection: "auto", active: true });
  });
  it("rejects maxStay < minStay, bad mode, bad time", () => {
    expect(offeringInput.safeParse({ ...base, minStay: 3, maxStay: 2 }).success).toBe(false);
    expect(offeringInput.safeParse({ ...base, rangeMode: "weeks" }).success).toBe(false);
    expect(offeringInput.safeParse({ ...base, startTime: "25:00" }).success).toBe(false);
  });
});
describe("unitInput / blackoutInput", () => {
  it("unit needs offeringId + name; blackout needs ordered dates", () => {
    expect(unitInput.safeParse({ offeringId: "not-uuid", name: "2B" }).success).toBe(false);
    const U = "00000000-0000-4000-8000-000000000000";
    expect(blackoutInput.safeParse({ offeringId: U, rentalUnitId: U, startDate: "2027-05-03", endDate: "2027-05-01" }).success).toBe(false);
    expect(blackoutInput.safeParse({ offeringId: U, rentalUnitId: U, startDate: "2027-05-01", endDate: "2027-05-01", reason: "" }).success).toBe(true);
  });
  it("caps the blackout span at 2 years", () => {
    const U = "00000000-0000-4000-8000-000000000000";
    const b = { offeringId: U, rentalUnitId: U, startDate: "2027-05-01" };
    expect(blackoutInput.safeParse({ ...b, endDate: "2029-04-30" }).success).toBe(true); // 730 days
    const tooLong = blackoutInput.safeParse({ ...b, endDate: "2029-05-01" }); // 731 days
    expect(tooLong.success).toBe(false);
    expect(tooLong.error!.issues[0].message).toBe("Blackout can span at most 2 years");
    expect(blackoutInput.safeParse({ ...b, endDate: "9999-12-31" }).success).toBe(false);
  });
});
describe("public inputs", () => {
  it("caps days at 93 and validates the booking payload", () => {
    const ok = { handle: "studio-berlin", offeringId: "00000000-0000-4000-8000-000000000000", fromDate: "2027-05-01", days: 93 };
    expect(getRangeAvailabilityInput.safeParse(ok).success).toBe(true);
    expect(getRangeAvailabilityInput.safeParse({ ...ok, days: 94 }).success).toBe(false);
    const b = { handle: "studio-berlin", offeringId: ok.offeringId, unitId: null, startDate: "2027-05-01", endDate: "2027-05-03", name: "Jamie", email: "j@example.com" };
    expect(createRentalBookingInput.safeParse(b).success).toBe(true);
    expect(createRentalBookingInput.safeParse({ ...b, email: "nope" }).success).toBe(false);
  });
});
describe("manage (token) inputs", () => {
  const U = "00000000-0000-4000-8000-000000000000";
  const token = (n: number) => "t".repeat(n);
  it("bounds the token at 20..200 chars and days at 1..93", () => {
    const ok = { token: token(20), fromDate: "2027-05-01", days: 93 };
    expect(manageRangeAvailabilityInput.safeParse(ok).success).toBe(true);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, token: token(200) }).success).toBe(true);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, token: token(19) }).success).toBe(false);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, token: token(201) }).success).toBe(false);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, days: 0 }).success).toBe(false);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, days: 94 }).success).toBe(false);
    expect(manageRangeAvailabilityInput.safeParse({ ...ok, fromDate: "01-05-2027" }).success).toBe(false);
  });
  it("reschedule takes the same token bounds and a null (auto) unit", () => {
    const r = { token: token(43), unitId: null, startDate: "2027-05-01", endDate: "2027-05-03" };
    expect(rescheduleRentalInput.safeParse(r).success).toBe(true);
    expect(rescheduleRentalInput.safeParse({ ...r, unitId: U }).success).toBe(true);
    // Auto must be said explicitly — a dropped field is a bug, not a default.
    expect(rescheduleRentalInput.safeParse({ ...r, unitId: undefined }).success).toBe(false);
    expect(rescheduleRentalInput.safeParse({ ...r, token: token(19) }).success).toBe(false);
    expect(rescheduleRentalInput.safeParse({ ...r, token: token(201) }).success).toBe(false);
    expect(rescheduleRentalInput.safeParse({ ...r, startDate: "01-05-2027" }).success).toBe(false);
    expect(rescheduleRentalInput.safeParse({ ...r, endDate: "2027-5-3" }).success).toBe(false);
  });
});
describe("hours offering input", () => {
  const base = {
    name: "Rehearsal Room",
    rangeMode: "hours" as const,
    slotIncrementMin: 30,
    minDurationMin: 60,
    maxDurationMin: 240,
    turnoverMin: 15,
    minNoticeMin: 120,
    bookingWindowDays: 60,
    unitSelection: "auto" as const,
    active: true,
  };
  it("accepts a valid hours offering without start/end times", () => {
    expect(offeringInput.safeParse(base).success).toBe(true);
  });
  it("rejects a min duration that is not a multiple of the increment", () => {
    expect(offeringInput.safeParse({ ...base, minDurationMin: 45 }).success).toBe(false);
  });
  it("rejects max < min duration", () => {
    expect(offeringInput.safeParse({ ...base, maxDurationMin: 30 }).success).toBe(false);
  });
  it("still accepts a nights offering exactly as before", () => {
    expect(
      offeringInput.safeParse({
        name: "Cabin", rangeMode: "nights", startTime: "15:00", endTime: "11:00",
        minStay: 1, maxStay: null, turnoverDays: 1, minNoticeDays: 0,
        bookingWindowDays: 180, unitSelection: "auto", active: true,
      }).success,
    ).toBe(true);
  });
  it("rejects hours fields on a nights offering", () => {
    expect(
      offeringInput.safeParse({
        name: "Cabin", rangeMode: "nights", startTime: "15:00", endTime: "11:00",
        minStay: 1, maxStay: null, turnoverDays: 1, minNoticeDays: 0,
        bookingWindowDays: 180, unitSelection: "auto", active: true,
        slotIncrementMin: 30,
      }).success,
    ).toBe(false);
  });
  it("rejects range fields (startTime/minStay) on an hours offering", () => {
    expect(offeringInput.safeParse({ ...base, startTime: "15:00" }).success).toBe(false);
    expect(offeringInput.safeParse({ ...base, minStay: 1 }).success).toBe(false);
  });
});
describe("admin inputs", () => {
  const U = "00000000-0000-4000-8000-000000000000";
  it("caps availability days at 93 and defaults excludeBookingId to null", () => {
    const ok = { offeringId: U, fromDate: "2027-05-01", days: 93 };
    const parsed = adminRangeAvailabilityInput.safeParse(ok);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.excludeBookingId).toBe(null);
    expect(adminRangeAvailabilityInput.safeParse({ ...ok, days: 94 }).success).toBe(false);
    expect(adminRangeAvailabilityInput.safeParse({ ...ok, days: 0 }).success).toBe(false);
    expect(adminRangeAvailabilityInput.safeParse({ ...ok, excludeBookingId: U }).success).toBe(true);
  });
  it("reschedule needs an id and accepts a null (auto) unit", () => {
    const r = { id: U, unitId: null, startDate: "2027-05-01", endDate: "2027-05-03" };
    expect(rescheduleRentalAdminInput.safeParse(r).success).toBe(true);
    expect(rescheduleRentalAdminInput.safeParse({ ...r, unitId: U }).success).toBe(true);
    expect(rescheduleRentalAdminInput.safeParse({ ...r, unitId: undefined }).success).toBe(false);
    expect(rescheduleRentalAdminInput.safeParse({ ...r, startDate: "01-05-2027" }).success).toBe(false);
  });
  it("walk-in creation accepts no email but rejects a malformed one", () => {
    const c = { offeringId: U, unitId: null, startDate: "2027-05-01", endDate: "2027-05-03", name: "Jamie" };
    const parsed = createRentalAdminInput.safeParse(c);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.email).toBeUndefined();
    expect(createRentalAdminInput.safeParse({ ...c, email: "j@example.com" }).success).toBe(true);
    expect(createRentalAdminInput.safeParse({ ...c, email: "nope" }).success).toBe(false);
    expect(createRentalAdminInput.safeParse({ ...c, name: "  " }).success).toBe(false);
  });
});
