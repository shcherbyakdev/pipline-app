import { describe, expect, it } from "vitest";
import {
  stayUnits, totalCents, depositCents, formatOfferingPrice,
  formatCancelWindow, moneyInfoLines, type MoneyFields,
} from "./pricing";

const base: MoneyFields = { priceCents: 10000, pricingMode: "per_unit", depositType: "none", depositValue: null };

describe("stayUnits", () => {
  it("nights = end - start", () => expect(stayUnits("nights", "2026-09-01", "2026-09-04")).toBe(3));
  it("days are inclusive", () => expect(stayUnits("days", "2026-09-01", "2026-09-04")).toBe(4));
});

describe("totalCents", () => {
  it("per-unit multiplies", () => expect(totalCents(base, 3)).toBe(30000));
  it("fractional hours round to the cent", () =>
    expect(totalCents(base, 90 / 60)).toBe(15000));
  it("uneven fraction rounds half up", () =>
    expect(totalCents({ ...base, priceCents: 9999 }, 100 / 60)).toBe(16665));
  it("flat ignores units", () =>
    expect(totalCents({ ...base, pricingMode: "flat" }, 5)).toBe(10000));
  it("unpriced is null", () => expect(totalCents({ ...base, priceCents: null }, 3)).toBeNull());
});

describe("depositCents", () => {
  it("none → null", () => expect(depositCents(base, 30000)).toBeNull());
  it("full → total", () =>
    expect(depositCents({ ...base, depositType: "full" }, 30000)).toBe(30000));
  it("percent rounds", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 33 }, 10050)).toBe(3317));
  it("fixed caps at total", () =>
    expect(depositCents({ ...base, depositType: "fixed", depositValue: 50000 }, 30000)).toBe(30000));
  it("fixed on an unpriced offering passes through", () =>
    expect(depositCents({ ...base, priceCents: null, depositType: "fixed", depositValue: 20000 }, null)).toBe(20000));
  it("percent with no total → null", () =>
    expect(depositCents({ ...base, depositType: "percent", depositValue: 20 }, null)).toBeNull());
});

describe("formatOfferingPrice", () => {
  it("per-unit names the unit from rangeMode", () => {
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "hours" }, "PLN"))
      .toBe("120 zł / hour");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "nights" }, "PLN"))
      .toBe("120 zł / night");
    expect(formatOfferingPrice({ priceCents: 12000, pricingMode: "per_unit", rangeMode: "days" }, "PLN"))
      .toBe("120 zł / day");
  });
  it("flat is bare", () =>
    expect(formatOfferingPrice({ priceCents: 50000, pricingMode: "flat", rangeMode: "hours" }, "PLN"))
      .toBe("500 zł"));
  it("unpriced → null", () =>
    expect(formatOfferingPrice({ priceCents: null, pricingMode: "flat", rangeMode: "days" }, "PLN")).toBeNull());
});

describe("formatCancelWindow", () => {
  it("whole days say days", () => expect(formatCancelWindow(2880)).toBe("2 days"));
  it("one day singular", () => expect(formatCancelWindow(1440)).toBe("1 day"));
  it("sub-day says hours", () => expect(formatCancelWindow(90)).toBe("1.5 hours"));
  it("one hour singular", () => expect(formatCancelWindow(60)).toBe("1 hour"));
});

describe("moneyInfoLines", () => {
  it("emits total, deposit, venue note and policy", () => {
    expect(moneyInfoLines({ totalCents: 30000, depositCents: 6000, currency: "PLN", cancelWindowMin: 1440 })).toEqual([
      "Total: 300 zł",
      "Deposit due: 60 zł",
      "Payment: pay at the venue",
      "Free cancellation until 1 day before start",
    ]);
  });
  it("no money → only the policy line when a window is set", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 120 }))
      .toEqual(["Free cancellation until 2 hours before start"]));
  it("nothing set → empty", () =>
    expect(moneyInfoLines({ totalCents: null, depositCents: null, currency: null, cancelWindowMin: 0 })).toEqual([]));
});
