import { describe, it, expect } from "vitest";
import { SPACES, APPOINTMENTS } from "./vocab";

/* What is left in vocab.ts after Wave 3 belongs to the studio, the links
   table and the landing (Waves 4–5); the admin words live in messages and
   src/i18n/messages.test.ts guards them. */
describe("vocabulary left for later waves", () => {
  it("names the channel Spaces on the studio and landing surfaces", () => {
    expect(SPACES.widgetGroup).toBe("Spaces");
    expect(SPACES.section).toEqual({ label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." });
    expect(SPACES.pickerTitle).toBe("Spaces");
    expect(SPACES.page).toBe("Spaces page");
    expect(APPOINTMENTS.page).toBe("Appointments page");
  });
  it("never says rental or offering", () => {
    const flatten = (v: unknown): string[] =>
      typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flatten) : [];
    const corpus = [...flatten(SPACES), ...flatten(APPOINTMENTS)].join("\n").toLowerCase();
    expect(corpus).not.toContain("rental");
    expect(corpus).not.toContain("offering");
  });
});
