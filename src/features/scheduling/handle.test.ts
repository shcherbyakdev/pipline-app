import { describe, it, expect } from "vitest";
import {
  HANDLE_RE,
  HANDLE_MAX,
  RESERVED_HANDLES,
  isReservedHandle,
  normalizeHandle,
  toDisplayName,
  suggestHandles,
} from "./handle";

describe("normalizeHandle", () => {
  it("lowercases and swaps spaces/underscores for dashes", () => {
    expect(normalizeHandle("Anna Studio")).toBe("anna-studio");
    expect(normalizeHandle("anna_studio")).toBe("anna-studio");
  });
  it("strips diacritics and anything outside [a-z0-9-]", () => {
    expect(normalizeHandle("Müller & Söhne!")).toBe("muller-sohne");
  });
  it("collapses dash runs and drops a leading dash, keeps a trailing one while typing", () => {
    expect(normalizeHandle("--anna--b")).toBe("anna-b");
    expect(normalizeHandle("anna-")).toBe("anna-");
  });
  it("caps at HANDLE_MAX", () => {
    expect(normalizeHandle("a".repeat(80))).toHaveLength(HANDLE_MAX);
  });
  it("output always satisfies HANDLE_RE once 3+ chars and not dash-terminated", () => {
    for (const raw of ["Anna", "anna b", "ANNA_B_C", "x y z"]) expect(HANDLE_RE.test(normalizeHandle(raw))).toBe(true);
  });
});

describe("toDisplayName", () => {
  it("title-cases dash-separated words", () => {
    expect(toDisplayName("anna-studio")).toBe("Anna Studio");
    expect(toDisplayName("anna")).toBe("Anna");
    expect(toDisplayName("")).toBe("");
  });
});

describe("suggestHandles", () => {
  it("offers suffixed candidates in order, all legal", () => {
    expect(suggestHandles("anna")).toEqual(["anna-studio", "anna-booking", "anna-2", "anna-3"]);
    for (const s of suggestHandles("anna")) expect(HANDLE_RE.test(s)).toBe(true);
  });
  it("trims the base so suffixed candidates stay within HANDLE_MAX", () => {
    const long = "a".repeat(HANDLE_MAX);
    for (const s of suggestHandles(long)) {
      expect(s.length).toBeLessThanOrEqual(HANDLE_MAX);
      expect(HANDLE_RE.test(s)).toBe(true);
    }
  });
  it("normalises its input first", () => {
    expect(suggestHandles("Anna-")[0]).toBe("anna-studio");
  });
});

describe("reserved handles", () => {
  it("includes every top-level app route and rejects them", () => {
    for (const h of ["login", "signup", "book", "bookings", "pricing", "api", "utils"]) {
      expect(isReservedHandle(h), h).toBe(true);
    }
    expect(isReservedHandle("anna")).toBe(false);
  });
  it("every reserved word is itself a legal handle shape (otherwise the DB CHECK already rejects it)", () => {
    for (const h of RESERVED_HANDLES) expect(HANDLE_RE.test(h), h).toBe(true);
  });
  it("has no duplicates", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });
});
