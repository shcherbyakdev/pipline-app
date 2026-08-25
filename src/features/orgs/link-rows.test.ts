import { describe, it, expect } from "vitest";
import { linkRows } from "./link-rows";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];

describe("linkRows (spec §5 — the Links & embeds table)", () => {
  it("both modes: page, the two channel rows, people, services, spaces — in that order", () => {
    const rows = linkRows({ mode: BOTH, staff, services, spaces });
    expect(rows.map((r) => r.label)).toEqual(["Whole booking page", "Appointments only", "Spaces only", "Anna", "Ben", "Massage", "Room A"]);
    expect(rows.map((r) => r.badge)).toEqual([null, null, null, "Team", "Team", "Service", "Space"]);
    expect(rows.map((r) => r.target)).toEqual([
      null, { channel: "services" }, { channel: "spaces" }, { staff: "anna" }, { staff: "ben" }, { service: "s1" }, { space: "o1" },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("single-mode orgs get no channel rows and only their own things", () => {
    expect(linkRows({ mode: APPTS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Anna", "Ben", "Massage"]);
    expect(linkRows({ mode: RENTALS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Room A"]);
  });
  it("a solo team lists no people (the caller passes [] then); nothing else changes", () => {
    expect(linkRows({ mode: BOTH, staff: [], services, spaces }).map((r) => r.label)).toEqual([
      "Whole booking page", "Appointments only", "Spaces only", "Massage", "Room A",
    ]);
  });
});
