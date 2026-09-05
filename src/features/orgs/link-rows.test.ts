import { describe, it, expect } from "vitest";
import { initialRowKey, linkRows, type LinkRow } from "./link-rows";

const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }];
const spaces = [{ id: "o1", name: "Room A" }];
// A page row's message key, or the thing's own name.
const label = (r: LinkRow) => ("key" in r.label ? r.label.key : r.label.name);

describe("linkRows (spec §5 — the embed page's Show select)", () => {
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

describe("initialRowKey (the Team / Service / Space pages' Embed links)", () => {
  const rows = linkRows({ mode: APPTS, staff, services, spaces });
  it("?staff=, ?service= and ?space= preselect that row", () => {
    expect(initialRowKey(rows, { staff: "ben" })).toBe("staff:ben");
    expect(initialRowKey(rows, { service: "s1" })).toBe("service:s1");
    expect(initialRowKey(linkRows({ mode: RENTALS, staff, services, spaces }), { space: "o1" })).toBe("space:o1");
  });
  it("the first known kind wins when two are given", () => {
    expect(initialRowKey(rows, { staff: "ben", service: "s1" })).toBe("staff:ben");
    expect(initialRowKey(rows, { staff: "zed", service: "s1" })).toBe("service:s1");
  });
  it("anything the rows don't list — unknown, wrong channel, repeated, absent — is the page", () => {
    expect(initialRowKey(rows, { staff: "zed" })).toBe("page");
    expect(initialRowKey(rows, { space: "o1" })).toBe("page");
    expect(initialRowKey(rows, { staff: ["anna", "ben"] })).toBe("page");
    expect(initialRowKey(rows, {})).toBe("page");
  });
});
