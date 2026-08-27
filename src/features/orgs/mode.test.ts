import { describe, it, expect } from "vitest";
import { channelsOf, defaultBookingsView, effectiveMode, modeOf, presentMode, BOTH } from "./mode";

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
  it("rentals-only without hourly offerings defaults to the timeline", () => {
    expect(defaultBookingsView(RENTALS_ONLY, false)).toBe("timeline");
  });

  it("rentals-only WITH hourly offerings defaults to the week grid — hourly bookings don't belong on the timeline", () => {
    expect(defaultBookingsView(RENTALS_ONLY, true)).toBe("week");
  });

  it("appointments-only and mixed orgs always default to week, regardless of hourly", () => {
    expect(defaultBookingsView(APPTS_ONLY, false)).toBe("week");
    expect(defaultBookingsView(APPTS_ONLY, true)).toBe("week");
    expect(defaultBookingsView(BOTH, false)).toBe("week");
    expect(defaultBookingsView(BOTH, true)).toBe("week");
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

describe("presentMode", () => {
  const NONE = { services: false, spaces: false };

  it("narrows a declared channel that has nothing bookable in it", () => {
    expect(presentMode(BOTH, { services: true, spaces: false })).toEqual(APPTS_ONLY);
    expect(presentMode(BOTH, { services: false, spaces: true })).toEqual(RENTALS_ONLY);
    expect(presentMode(BOTH, { services: true, spaces: true })).toEqual(BOTH);
  });

  it("never widens: data in a channel the org turned off stays off", () => {
    expect(presentMode(APPTS_ONLY, { services: true, spaces: true })).toEqual(APPTS_ONLY);
    expect(presentMode(RENTALS_ONLY, { services: true, spaces: true })).toEqual(RENTALS_ONLY);
  });

  it("an org with nothing anywhere keeps its declared mode, so a preview still has something to show", () => {
    expect(presentMode(BOTH, NONE)).toEqual(BOTH);
    expect(presentMode(APPTS_ONLY, NONE)).toEqual(APPTS_ONLY);
    expect(presentMode(RENTALS_ONLY, NONE)).toEqual(RENTALS_ONLY);
  });

  it("a declared channel with nothing falls back only when the other declared channel is empty too", () => {
    // Appointments-only org that somehow has spaces data but no services:
    // the spaces can't be shown (not declared) and there are no services —
    // nothing bookable → declared mode.
    expect(presentMode(APPTS_ONLY, { services: false, spaces: true })).toEqual(APPTS_ONLY);
  });
});
