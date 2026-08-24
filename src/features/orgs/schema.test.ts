import { describe, it, expect } from "vitest";
import { createOrgSchema, updateAccentInput, createOrgWithPageSchema, modeToFlags } from "./schema";

describe("createOrgSchema", () => {
  it("accepts a valid name", () => {
    expect(createOrgSchema.safeParse({ name: "Acme Signage" }).success).toBe(true);
  });
  it("rejects a name shorter than 2 chars", () => {
    expect(createOrgSchema.safeParse({ name: "A" }).success).toBe(false);
  });
  it("rejects a name longer than 80 chars", () => {
    expect(createOrgSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(createOrgSchema.safeParse({ name: "  Acme  " }).data?.name).toBe("Acme");
  });
});

describe("accent colour input", () => {
  it("normalises to lowercase and accepts null", () => {
    expect(updateAccentInput.parse({ accentColor: "#0F766E" }).accentColor).toBe("#0f766e");
    expect(updateAccentInput.parse({ accentColor: null }).accentColor).toBeNull();
  });
  it("rejects non-hex", () => {
    expect(updateAccentInput.safeParse({ accentColor: "teal" }).success).toBe(false);
    expect(updateAccentInput.safeParse({ accentColor: "#fff" }).success).toBe(false);
  });
});

describe("createOrgWithPageSchema", () => {
  it("accepts name + handle + timezone", () => {
    expect(
      createOrgWithPageSchema.parse({
        name: "Anna Studio",
        handle: "anna-studio",
        timezone: "Europe/Warsaw",
        mode: "appointments",
      }),
    ).toEqual({
      name: "Anna Studio",
      handle: "anna-studio",
      timezone: "Europe/Warsaw",
      mode: "appointments",
    });
  });
  it("maps an empty handle to null", () => {
    expect(
      createOrgWithPageSchema.parse({ name: "Anna", handle: "", timezone: "UTC", mode: "appointments" }).handle,
    ).toBeNull();
  });
  it("rejects a malformed or reserved handle and a missing timezone", () => {
    expect(
      createOrgWithPageSchema.safeParse({ name: "Anna", handle: "-x", timezone: "UTC", mode: "appointments" })
        .success,
    ).toBe(false);
    expect(
      createOrgWithPageSchema.safeParse({ name: "Anna", handle: "signup", timezone: "UTC", mode: "appointments" })
        .success,
    ).toBe(false);
    expect(
      createOrgWithPageSchema.safeParse({ name: "Anna", handle: "anna", timezone: "", mode: "appointments" })
        .success,
    ).toBe(false);
  });
});

const BASE = { name: "Anna Studio", handle: "anna-studio", timezone: "Europe/Warsaw" };

describe("createOrgWithPageSchema mode", () => {
  it("requires a mode", () => {
    expect(createOrgWithPageSchema.safeParse(BASE).success).toBe(false);
    expect(createOrgWithPageSchema.safeParse({ ...BASE, mode: "hourly" }).success).toBe(false);
  });
  it("accepts the three modes", () => {
    for (const mode of ["appointments", "rentals", "both"]) {
      expect(createOrgWithPageSchema.safeParse({ ...BASE, mode }).success).toBe(true);
    }
  });
});

describe("modeToFlags", () => {
  it("maps each mode to its flag pair", () => {
    expect(modeToFlags("appointments")).toEqual({ offersAppointments: true, offersRentals: false });
    expect(modeToFlags("rentals")).toEqual({ offersAppointments: false, offersRentals: true });
    expect(modeToFlags("both")).toEqual({ offersAppointments: true, offersRentals: true });
  });
});
