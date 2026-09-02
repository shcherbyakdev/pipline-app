import { describe, it, expect } from "vitest";
import { bookingTitle } from "./booking-label";

/* The bookings list and every app-built mail name a booking through this.
   A single-unit space's unit is named after the space (rentals/actions.ts),
   so "Flat · Flat" is the title it used to produce. */
describe("bookingTitle", () => {
  it("names an appointment by its service", () => {
    expect(bookingTitle({ services: { name: "Massage" } }, "Appointment")).toBe("Massage");
  });
  it("names a split space's booking by space and unit", () => {
    expect(
      bookingTitle({ rental_offerings: { name: "Studio" }, rental_units: { name: "Room A" } }, "Appointment"),
    ).toBe("Studio · Room A");
  });
  it("drops a unit named after its space", () => {
    expect(
      bookingTitle({ rental_offerings: { name: "Flat" }, rental_units: { name: "Flat" } }, "Appointment"),
    ).toBe("Flat");
  });
  it("falls back when a row names neither", () => {
    expect(bookingTitle({}, "Appointment")).toBe("Appointment");
  });
});
