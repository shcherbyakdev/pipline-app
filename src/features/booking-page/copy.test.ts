import { describe, it, expect } from "vitest";
import { STARTER } from "./copy";
import { BUSINESS_TYPES } from "./business-types";
import { FORBIDDEN_COPY } from "@/features/marketing/site";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (...args: string[]) => string)("hour", "PLN"))];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("starter copy (spec 2026-08-28 §1, §5)", () => {
  it("never says rental, rentals or offering — the starter, the type cards, and slice 1's vocab words", () => {
    const corpus = [
      ...strings(STARTER),
      ...BUSINESS_TYPES.flatMap((t) => [t.name, t.examples, t.copy.bookingTitle, t.copy.cta ?? ""]),
      APPOINTMENTS.page, SPACES.page, APPOINTMENTS.crossLink, SPACES.crossLink,
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });
  it("asks the one question the spec asks, and never offers a skip", () => {
    expect(STARTER.title).toBe("What kind of business is this?");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("skip");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("later");
  });
});
