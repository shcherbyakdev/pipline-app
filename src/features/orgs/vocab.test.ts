import { describe, it, expect } from "vitest";
import { SPACES, bookingDescription } from "./vocab";

const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("SPACES vocabulary", () => {
  it("names the channel Spaces on every surface a person reads", () => {
    expect(SPACES.nav).toBe("Spaces");
    expect(SPACES.widgetGroup).toBe("Spaces");
    expect(SPACES.section).toEqual({ label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." });
    expect(SPACES.pickerTitle).toBe("Spaces");
    expect(SPACES.pickerBlurb).toBe("Rooms, studios and gear, booked by the hour, night or day.");
    expect(SPACES.pickerBothBlurb).toBe("You book people and spaces.");
  });
});

describe("bookingDescription", () => {
  it("appointments-only keeps the historical sentence", () => {
    expect(bookingDescription(APPTS_ONLY, "Anna's")).toBe("Book an appointment with Anna's.");
  });
  it("rentals-only says space", () => {
    expect(bookingDescription(RENTALS_ONLY, "Loft 3")).toBe("Book a space at Loft 3.");
  });
  it("both channels use the neutral sentence", () => {
    expect(bookingDescription(BOTH, "Demo")).toBe("Book with Demo.");
  });
});
