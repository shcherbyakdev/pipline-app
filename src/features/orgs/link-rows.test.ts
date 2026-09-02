import { describe, it, expect } from "vitest";
import { linkRows, type LinkRow } from "./link-rows";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];
// A page row's message key, or the thing's own name.
const label = (r: LinkRow) => ("key" in r.label ? r.label.key : r.label.name);

describe("linkRows (spec §5 — the Links & embeds table)", () => {
  it("both modes: the two channel pages (never a whole-catalogue row — an embed is one channel), spaces, people, services — in that order", () => {
    const rows = linkRows({ mode: BOTH, staff, services, spaces });
    expect(rows.map(label)).toEqual(["appointmentsPage", "spacesPage", "Room A", "Anna", "Ben", "Massage"]);
    expect(rows.map((r) => r.badge)).toEqual([null, null, "space", "team", "team", "service"]);
    expect(rows.map((r) => r.target)).toEqual([
      { channel: "services" }, { channel: "spaces" }, { space: "o1" }, { staff: "anna" }, { staff: "ben" }, { service: "s1" },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("single-mode orgs get one page row (their only channel) and only their own things", () => {
    const appts = linkRows({ mode: APPTS, staff, services, spaces });
    expect(appts.map(label)).toEqual(["bookingPage", "Anna", "Ben", "Massage"]);
    expect(appts[0]!.target).toBeNull();
    expect(linkRows({ mode: RENTALS, staff, services, spaces }).map(label)).toEqual(["bookingPage", "Room A"]);
  });
  it("a solo team lists no people (the caller passes [] then); nothing else changes", () => {
    expect(linkRows({ mode: BOTH, staff: [], services, spaces }).map(label)).toEqual([
      "appointmentsPage", "spacesPage", "Room A", "Massage",
    ]);
  });
});
