import { describe, it, expect } from "vitest";
import { slugifyStaffName, STAFF_SLUG_RE, nextStaffColor, STAFF_COLORS, initials } from "./staff-slug";

describe("slugifyStaffName", () => {
  it("lowercases, strips diacritics, hyphenates", () => expect(slugifyStaffName("Anna Müller")).toBe("anna-muller"));
  it("empty → team-member", () => expect(slugifyStaffName("  ")).toBe("team-member"));
  it("single char padded", () => expect(slugifyStaffName("A")).toBe("a-1"));
  it("clamps to 40 and always matches the regex", () => {
    const s = slugifyStaffName("x".repeat(60) + "-");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(STAFF_SLUG_RE.test(s)).toBe(true);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => expect(initials("Anna Müller")).toBe("AM"));
  it("ignores anything past the second word", () => expect(initials("Jo Ann van Dijk")).toBe("JA"));
  it("uppercases", () => expect(initials("anna")).toBe("A"));
  it("tolerates extra whitespace", () => expect(initials("  anna   müller  ")).toBe("AM"));
  it("empty → empty", () => expect(initials("   ")).toBe(""));
});

describe("nextStaffColor", () => {
  it("first unused, then cycles", () => {
    expect(nextStaffColor([])).toBe(STAFF_COLORS[0]);
    expect(nextStaffColor([STAFF_COLORS[0]])).toBe(STAFF_COLORS[1]);
    expect(nextStaffColor([...STAFF_COLORS])).toBe(STAFF_COLORS[0]);
  });
});
