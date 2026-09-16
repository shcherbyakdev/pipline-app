import { describe, it, expect } from "vitest";
import { hasChoice, initialPick, pickTarget, showOptions } from "./link-rows";

const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const staff = [{ slug: "anna", name: "Anna" }, { slug: "ben", name: "Ben" }];
const services = [{ id: "s1", name: "Massage" }, { id: "s2", name: "Facial" }];
const spaces = [{ id: "o1", name: "Room A" }, { id: "o2", name: "Room B" }];
const page = { show: "page", ids: [], lang: "" };

describe("showOptions (the embed page's Show select)", () => {
  it("only the org's own channel: people and services, or spaces", () => {
    expect(showOptions({ mode: APPTS, staff, services, spaces })).toEqual({ people: staff, services, spaces: [] });
    expect(showOptions({ mode: RENTALS, staff, services, spaces })).toEqual({ people: [], services: [], spaces });
  });
  it("a single service or space is nothing to choose between; a solo team passes [] itself", () => {
    const o = showOptions({ mode: APPTS, staff: [], services: [services[0]!], spaces });
    expect(o).toEqual({ people: [], services: [], spaces: [] });
    expect(hasChoice(o)).toBe(false);
    expect(hasChoice(showOptions({ mode: RENTALS, staff, services, spaces }))).toBe(true);
  });
});

describe("pickTarget", () => {
  const o = showOptions({ mode: APPTS, staff, services, spaces });
  it("the page, a person, ticked services in option order", () => {
    expect(pickTarget(page, o)).toBeNull();
    expect(pickTarget({ ...page, show: "staff:ben" }, o)).toEqual({ staff: "ben" });
    expect(pickTarget({ ...page, show: "services", ids: ["s2", "s1"] }, o)).toEqual({ services: ["s1", "s2"] });
    expect(pickTarget({ ...page, show: "spaces", ids: ["o2"] }, showOptions({ mode: RENTALS, staff, services, spaces }))).toEqual({ spaces: ["o2"] });
  });
  it("nothing ticked, unknown ticks, an unknown person or the other channel mean the page", () => {
    expect(pickTarget({ ...page, show: "services" }, o)).toBeNull();
    expect(pickTarget({ ...page, show: "services", ids: ["zed"] }, o)).toBeNull();
    expect(pickTarget({ ...page, show: "staff:zed" }, o)).toBeNull();
    expect(pickTarget({ ...page, show: "spaces", ids: ["o1"] }, o)).toBeNull();
  });
});

describe("initialPick (the Team / Service / Space pages' Embed links)", () => {
  const o = showOptions({ mode: APPTS, staff, services, spaces });
  const r = showOptions({ mode: RENTALS, staff, services, spaces });
  it("?staff=, ?service= and ?space= land on that person or tick those items", () => {
    expect(initialPick(o, { staff: "ben" })).toEqual({ ...page, show: "staff:ben" });
    expect(initialPick(o, { service: "s1" })).toEqual({ ...page, show: "services", ids: ["s1"] });
    expect(initialPick(r, { space: "o2,o1" })).toEqual({ ...page, show: "spaces", ids: ["o2", "o1"] });
  });
  it("a person wins over a list; unknown ids are dropped from a list", () => {
    expect(initialPick(o, { staff: "ben", service: "s1" }).show).toBe("staff:ben");
    expect(initialPick(o, { staff: "zed", service: "zed,s2" })).toEqual({ ...page, show: "services", ids: ["s2"] });
  });
  it("anything the options don't list — unknown, wrong channel, repeated, absent — is the page", () => {
    expect(initialPick(o, { staff: "zed" })).toEqual(page);
    expect(initialPick(o, { space: "o1" })).toEqual(page);
    expect(initialPick(o, { service: ["s1", "s2"] })).toEqual(page);
    expect(initialPick(o, {})).toEqual(page);
  });
});
