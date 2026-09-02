import { describe, it, expect } from "vitest";
import { STARTER } from "./copy";
import { STAY_LAYOUT_OPTIONS, WIDGET_LAYOUT_OPTIONS } from "@/lib/widget-theme";
import { FORBIDDEN_COPY } from "@/features/marketing/site";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (...args: string[]) => string)("hour", "PLN"))];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("starter copy (spec 2026-08-28 §1, §5)", () => {
  it("never says rental, rentals or offering — the starter, the layout cards, and slice 1's vocab words", () => {
    const corpus = [
      ...strings(STARTER),
      ...WIDGET_LAYOUT_OPTIONS.flatMap((o) => [o.label, o.description]),
      ...STAY_LAYOUT_OPTIONS.flatMap((o) => [o.label, o.description]),
      APPOINTMENTS.page, SPACES.page,
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });
  it("asks the one question the spec asks — how clients pick a time — and never offers a skip", () => {
    expect(STARTER.title).toBe("How should clients pick a time?");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("skip");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("later");
  });
});
