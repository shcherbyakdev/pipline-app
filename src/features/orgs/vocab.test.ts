import { describe, it, expect } from "vitest";
import { SPACES, APPOINTMENTS, bookingDescription } from "./vocab";

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
    expect(SPACES.pickerBothBlurb).toBe("You book spaces and people.");
  });
  it("explains hours for nightly/daily spaces on the Availability page (spec §3)", () => {
    expect(SPACES.hoursNote).toBe(
      "Nightly and daily spaces use check-in and check-out times instead — set those on the space.",
    );
    expect(SPACES.hoursNightsOnly).toBe(
      "Nightly and daily spaces use check-in and check-out times, set on each space. Hourly spaces and team members set their weekly hours here.",
    );
  });
  it("names the per-channel link rows (spec §5)", () => {
    expect(SPACES.only).toBe("Spaces only");
    expect(APPOINTMENTS.only).toBe("Appointments only");
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

describe("admin vocabulary (admin IA spec §1)", () => {
  const flatten = (v: unknown): string[] =>
    typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flatten) : [];

  it("never says rental or offering to a provider", () => {
    const corpus = [...flatten(SPACES), ...flatten(APPOINTMENTS)].join("\n").toLowerCase();
    for (const word of ["rental", "offering"]) {
      expect(corpus, `vocab mentions "${word}"`).not.toContain(word);
    }
  });

  it("names every admin surface this slice touches", () => {
    expect(SPACES.one).toBe("space");
    expect(SPACES.newButton).toBe("New space");
    expect(SPACES.dialogTitle).toEqual({ new: "New space", edit: "Edit space" });
    expect(SPACES.back).toBe("← Spaces");
    expect(SPACES.empty).toBe(
      "No spaces yet — a space is a room, studio or item clients book by the hour, night or day. Add one, then add its units.",
    );
    expect(SPACES.timelineEmpty).toBe("No spaces yet — add a space and its units under");
    expect(SPACES.unitsHint).toBe("Units are the individual rooms or items a client is assigned — one per room.");
    expect(SPACES.unitsEmpty).toBe(
      "No units yet — the space won't appear on your booking page until it has an active unit.",
    );
    expect(SPACES.field).toBe("Space");
    expect(SPACES.command).toBe("New space");
    expect(SPACES.settings).toEqual({
      label: "Spaces",
      blurb: "Rooms, studios and gear, booked by the hour, night or day.",
    });
    expect(SPACES.add).toBe("Add a space");
    expect(APPOINTMENTS.settings).toEqual({
      label: "Appointments",
      blurb: "Services booked as time slots with your team.",
    });
    expect(APPOINTMENTS.add).toBe("Add a service");
    expect(SPACES.pickerBoth).toBe("Space or service");
    expect(SPACES.badge).toBe("Space");
    expect(SPACES.hidden(1)).toBe("1 space booking hidden");
    expect(SPACES.hidden(3)).toBe("3 space bookings hidden");
    expect(APPOINTMENTS.field).toBe("Service");
  });
});
