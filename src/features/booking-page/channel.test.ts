import { describe, it, expect } from "vitest";
import { PAGE_CHANNELS, pageChannelMode, parsePageChannel } from "./channel";

describe("PageChannel (spec 2026-08-28 §1)", () => {
  it("is exactly appointments and spaces", () => {
    expect(PAGE_CHANNELS).toEqual(["appointments", "spaces"]);
  });
  it("pageChannelMode is the single-channel OrgMode", () => {
    expect(pageChannelMode("appointments")).toEqual({ offersAppointments: true, offersRentals: false });
    expect(pageChannelMode("spaces")).toEqual({ offersAppointments: false, offersRentals: true });
  });
  it("parsePageChannel accepts the two words and nothing else", () => {
    expect(parsePageChannel("appointments")).toBe("appointments");
    expect(parsePageChannel("spaces")).toBe("spaces");
    expect(parsePageChannel("services")).toBeNull();
    expect(parsePageChannel("Spaces")).toBeNull();
    expect(parsePageChannel(["spaces"])).toBeNull();
    expect(parsePageChannel(undefined)).toBeNull();
  });
});
