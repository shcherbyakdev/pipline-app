import { describe, it, expect } from "vitest";
import { linkRows } from "./link-rows";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];

describe("linkRows (spec §5 — the Links & embeds table)", () => {
  it("both modes: page, the two channel rows, spaces, people, services — in that order", () => {
    const rows = linkRows({ mode: BOTH, staff, services, spaces });
    expect(rows.map((r) => r.label)).toEqual(["Whole booking page", "Spaces only", "Appointments only", "Room A", "Anna", "Ben", "Massage"]);
    expect(rows.map((r) => r.badge)).toEqual([null, null, null, "Space", "Team", "Team", "Service"]);
    expect(rows.map((r) => r.target)).toEqual([
      null, { channel: "spaces" }, { channel: "services" }, { space: "o1" }, { staff: "anna" }, { staff: "ben" }, { service: "s1" },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("single-mode orgs get no channel rows and only their own things", () => {
    expect(linkRows({ mode: APPTS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Anna", "Ben", "Massage"]);
    expect(linkRows({ mode: RENTALS, staff, services, spaces }).map((r) => r.label)).toEqual(["Whole booking page", "Room A"]);
  });
  it("a solo team lists no people (the caller passes [] then); nothing else changes", () => {
    expect(linkRows({ mode: BOTH, staff: [], services, spaces }).map((r) => r.label)).toEqual([
      "Whole booking page", "Spaces only", "Appointments only", "Room A", "Massage",
    ]);
  });
});
