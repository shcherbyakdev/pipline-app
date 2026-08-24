import { describe, expect, it } from "vitest";
import { formatMoney, CURRENCIES } from "./money";

describe("formatMoney", () => {
  it("formats whole PLN without decimals", () => {
    expect(formatMoney(12000, "PLN")).toBe("120 zł");
  });
  it("keeps cents when present", () => {
    expect(formatMoney(12050, "PLN")).toBe("120,50 zł");
  });
  it("formats EUR/USD in their home locales", () => {
    expect(formatMoney(9900, "EUR")).toBe("99 €");
    expect(formatMoney(9900, "USD")).toBe("$99");
  });
  it("falls back to en for an unknown code without throwing", () => {
    expect(formatMoney(500, "XXX")).toContain("5");
  });
  it("whitelist is exactly the five launch currencies", () => {
    expect(CURRENCIES).toEqual(["PLN", "EUR", "USD", "GBP", "CZK"]);
  });
});
