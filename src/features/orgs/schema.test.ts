import { describe, it, expect } from "vitest";
import { createOrgSchema, updateAccentInput, createOrgWithPageSchema, modeToFlags, updateOrgModesInput, surfaceThemeInput,
  widgetThemeInput,
} from "./schema";

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
  // Mode left this schema: every org is created as appointments and the
  // wizard's mode step (update_org_modes) owns the choice now.
  it("accepts name + handle + timezone", () => {
    expect(
      createOrgWithPageSchema.parse({
        name: "Anna Studio",
        handle: "anna-studio",
        timezone: "Europe/Warsaw",
      }),
    ).toEqual({
      name: "Anna Studio",
      handle: "anna-studio",
      timezone: "Europe/Warsaw",
    });
  });
  it("maps an empty handle to null", () => {
    expect(createOrgWithPageSchema.parse({ name: "Anna", handle: "", timezone: "UTC" }).handle).toBeNull();
  });
  it("rejects a malformed or reserved handle and a missing timezone", () => {
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "-x", timezone: "UTC" }).success).toBe(false);
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "signup", timezone: "UTC" }).success).toBe(false);
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "anna", timezone: "" }).success).toBe(false);
  });
});

describe("modeToFlags", () => {
  it("maps each mode to its flag pair", () => {
    expect(modeToFlags("appointments")).toEqual({ offersAppointments: true, offersRentals: false });
    expect(modeToFlags("rentals")).toEqual({ offersAppointments: false, offersRentals: true });
  });
});

describe("updateOrgModesInput", () => {
  it("accepts one of the two channels and nothing else", () => {
    expect(updateOrgModesInput.safeParse({ mode: "appointments" }).success).toBe(true);
    expect(updateOrgModesInput.safeParse({ mode: "rentals" }).success).toBe(true);
    expect(updateOrgModesInput.safeParse({ mode: "both" }).success).toBe(false);
    expect(updateOrgModesInput.safeParse({ offersAppointments: true, offersRentals: false }).success).toBe(false);
  });
});


describe("surfaceThemeInput (spec 2026-09-02 §9: one appearance per surface)", () => {
  const theme = { theme: "light", radius: "subtle", font: "geist", layout: "calendar", stayLayout: "one-month", hidePoweredBy: false };
  it("names the surface — the hosted page or the website embed — and carries a full theme", () => {
    expect(surfaceThemeInput.safeParse({ surface: "page", theme }).success).toBe(true);
    expect(surfaceThemeInput.safeParse({ surface: "embed", theme }).success).toBe(true);
    expect(surfaceThemeInput.safeParse({ surface: "email", theme }).success).toBe(false);
    expect(surfaceThemeInput.safeParse({ theme }).success).toBe(false);
  });
  it("the theme half is exactly the widget theme input", () => {
    expect(widgetThemeInput.safeParse({ ...theme, layout: "carousel" }).success).toBe(false);
    expect(surfaceThemeInput.safeParse({ surface: "page", theme: { ...theme, layout: "carousel" } }).success).toBe(false);
  });
});