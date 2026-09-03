import { describe, it, expect } from "vitest";
import { slotLostMessage, SLOT_TAKEN, STAFF_UNAVAILABLE } from "./booking-errors";
import en from "../../../messages/en.json";

// The regression this guards: the widget sends a NAMED staff id even in a solo
// org (so the RPC does its strict check), so `staffId !== "any"` on its own is
// not evidence of a team — reading it that way showed solo orgs "that team
// member can't take this time", copy about a team they don't have.
describe("slotLostMessage", () => {
  it("solo org, named staff id → the plain taken message", () => {
    expect(slotLostMessage("11111111-1111-1111-1111-111111111111", 1)).toBe(SLOT_TAKEN);
  });

  it("org with no staff at all → the plain taken message", () => {
    expect(slotLostMessage("11111111-1111-1111-1111-111111111111", 0)).toBe(SLOT_TAKEN);
  });

  it("team org, named staff id → names the team member", () => {
    expect(slotLostMessage("11111111-1111-1111-1111-111111111111", 2)).toBe(STAFF_UNAVAILABLE);
  });

  it('"any" is never about one person, whatever the count', () => {
    expect(slotLostMessage("any", 1)).toBe(SLOT_TAKEN);
    expect(slotLostMessage("any", 5)).toBe(SLOT_TAKEN);
  });

  it("both outcomes are keys under errors.* (resolved in the page's locale by the action)", () => {
    expect(en.errors[SLOT_TAKEN]).toBeTruthy();
    expect(en.errors[STAFF_UNAVAILABLE]).toBeTruthy();
  });
});
