import { describe, it, expect } from "vitest";
import { linkRows, type LinkRow } from "./link-rows";

const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];
// A page row's message key, or the thing's own name.
const label = (r: LinkRow) => ("key" in r.label ? r.label.key : r.label.name);

describe("linkRows (spec §5 — the Links & embeds table)", () => {
  it("the page row first, then only the org's own channel: people and services, or spaces", () => {
    const appts = linkRows({ mode: APPTS, staff, services, spaces });
    expect(appts.map(label)).toEqual(["bookingPage", "Anna", "Ben", "Massage"]);
    expect(appts.map((r) => r.badge)).toEqual([null, "team", "team", "service"]);
    expect(appts.map((r) => r.target)).toEqual([null, { staff: "anna" }, { staff: "ben" }, { service: "s1" }]);
    expect(new Set(appts.map((r) => r.key)).size).toBe(appts.length);
    const rentals = linkRows({ mode: RENTALS, staff, services, spaces });
    expect(rentals.map(label)).toEqual(["bookingPage", "Room A"]);
    expect(rentals.map((r) => r.target)).toEqual([null, { space: "o1" }]);
  });
  it("a solo team lists no people (the caller passes [] then); nothing else changes", () => {
    expect(linkRows({ mode: APPTS, staff: [], services, spaces }).map(label)).toEqual(["bookingPage", "Massage"]);
  });
});
