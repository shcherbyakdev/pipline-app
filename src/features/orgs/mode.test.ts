import { describe, it, expect } from "vitest";
import { defaultBookingsView, effectiveMode, modeOf } from "./mode";

const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };

describe("defaultBookingsView", () => {
  it("rentals without hourly offerings defaults to the timeline", () => {
    expect(defaultBookingsView(RENTALS_ONLY, false)).toBe("timeline");
  });

  it("rentals WITH hourly offerings defaults to the week grid — hourly bookings don't belong on the timeline", () => {
    expect(defaultBookingsView(RENTALS_ONLY, true)).toBe("week");
  });

  it("appointments always default to week, regardless of hourly", () => {
    expect(defaultBookingsView(APPTS_ONLY, false)).toBe("week");
    expect(defaultBookingsView(APPTS_ONLY, true)).toBe("week");
  });
});

describe("modeOf", () => {
  it("projects the two flags off a wider org record", () => {
    expect(modeOf({ offersAppointments: true, offersRentals: false })).toEqual(APPTS_ONLY);
  });
});

describe("effectiveMode", () => {
  it("kill switch off → offersRentals false regardless of the org's declared mode", () => {
    expect(effectiveMode({ rentals: false }, RENTALS_ONLY)).toEqual({
      offersAppointments: false,
      offersRentals: false,
    });
    expect(effectiveMode({ rentals: false }, APPTS_ONLY)).toEqual(APPTS_ONLY);
  });

  it("kill switch on → passes the org's declared mode through unchanged", () => {
    expect(effectiveMode({ rentals: true }, RENTALS_ONLY)).toEqual(RENTALS_ONLY);
    expect(effectiveMode({ rentals: true }, APPTS_ONLY)).toEqual(APPTS_ONLY);
  });
});
