import { describe, it, expect } from "vitest";
import { SPACES } from "./vocab";

/* What is left in vocab.ts belongs to the landing page (Wave 5); the
   admin's, studio's and embed's words live in messages and
   src/i18n/messages.test.ts guards them. */
describe("vocabulary left for the landing", () => {
  it("names the channel Spaces", () => {
    expect(SPACES.widgetGroup).toBe("Spaces");
    expect(SPACES.pickerTitle).toBe("Spaces");
  });
  it("never says rental or offering", () => {
    const corpus = Object.values(SPACES).join("\n").toLowerCase();
    expect(corpus).not.toContain("rental");
    expect(corpus).not.toContain("offering");
  });
});
