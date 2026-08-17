import { describe, it, expect } from "vitest";
import { offeringInput, unitInput, blackoutInput, getRangeAvailabilityInput, createRentalBookingInput } from "./schema";

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
