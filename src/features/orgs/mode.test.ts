import { describe, it, expect } from "vitest";
import { channelsOf, defaultBookingsView, effectiveMode, modeOf, BOTH } from "./mode";

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

describe("effectiveMode", () => {
  it("kill switch off → offersRentals false regardless of the org's declared mode", () => {
    expect(effectiveMode({ rentals: false }, BOTH)).toEqual(APPTS_ONLY);
    expect(effectiveMode({ rentals: false }, RENTALS_ONLY)).toEqual({
      offersAppointments: false,
      offersRentals: false,
    });
    expect(effectiveMode({ rentals: false }, APPTS_ONLY)).toEqual(APPTS_ONLY);
  });

  it("kill switch on → passes the org's declared mode through unchanged", () => {
    expect(effectiveMode({ rentals: true }, BOTH)).toEqual(BOTH);
    expect(effectiveMode({ rentals: true }, RENTALS_ONLY)).toEqual(RENTALS_ONLY);
    expect(effectiveMode({ rentals: true }, APPTS_ONLY)).toEqual(APPTS_ONLY);
  });
});
