import { describe, it, expect } from "vitest";
import {
  WIDGET_THEME_DEFAULTS, parseWidgetTheme, themeCssVars, contrastRatio,
} from "./widget-theme";

describe("parseWidgetTheme", () => {
  it("null → defaults", () => {
    expect(parseWidgetTheme(null)).toEqual(WIDGET_THEME_DEFAULTS);
  });
  it("merges partial stored config over defaults and drops junk", () => {
    expect(parseWidgetTheme({ theme: "dark", font: "lora", bogus: 1 })).toEqual({
      ...WIDGET_THEME_DEFAULTS, theme: "dark", font: "lora",
    });
  });
  it("ignores invalid stored values", () => {
    expect(parseWidgetTheme({ theme: "neon", background: "red" })).toEqual(WIDGET_THEME_DEFAULTS);
  });
});

describe("themeCssVars", () => {
  it("maps radius and accent, omits bg/text unless overridden", () => {
    const vars = themeCssVars({ ...WIDGET_THEME_DEFAULTS, radius: "round" }, "#ff0000");
    expect(vars).toEqual({ "--widget-accent": "#ff0000", "--widget-radius": "12px" });
  });
  it("includes overrides when set and falls back accent", () => {
    const vars = themeCssVars(
      { ...WIDGET_THEME_DEFAULTS, background: "#101010", text: "#fafafa" }, null,
    );
    expect(vars["--widget-bg" as keyof typeof vars]).toBe("#101010");
    expect(vars["--widget-text" as keyof typeof vars]).toBe("#fafafa");
    expect(vars["--widget-accent" as keyof typeof vars]).toBe("#0f172a");
  });
});

describe("contrastRatio", () => {
  it("black on white is 21, self is 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#808080", "#808080")).toBe(1);
  });
  it("is symmetric and flags low-contrast pairs", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(1.3);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(contrastRatio("#000000", "#ffffff"), 5);
  });
});
