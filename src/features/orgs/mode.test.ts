import { describe, it, expect } from "vitest";
import { channelsOf, defaultBookingsView, modeOf, BOTH } from "./mode";

const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };

describe("channelsOf", () => {
  it("lists enabled channels in a stable order", () => {
    expect(channelsOf(BOTH)).toEqual(["appointments", "rentals"]);
    expect(channelsOf(RENTALS_ONLY)).toEqual(["rentals"]);
    expect(channelsOf(APPTS_ONLY)).toEqual(["appointments"]);
  });
});

describe("defaultBookingsView", () => {
  it("rentals-only defaults to the timeline, everything else to week", () => {
    expect(defaultBookingsView(RENTALS_ONLY)).toBe("timeline");
    expect(defaultBookingsView(APPTS_ONLY)).toBe("week");
    expect(defaultBookingsView(BOTH)).toBe("week");
  });
});

describe("modeOf", () => {
  it("projects the two flags off a wider org record", () => {
    expect(modeOf({ offersAppointments: true, offersRentals: false })).toEqual(APPTS_ONLY);
  });
});
