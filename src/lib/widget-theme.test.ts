import { describe, it, expect } from "vitest";
import {
  WIDGET_THEME_DEFAULTS, parseWidgetTheme, themeCssVars, contrastRatio, effectiveContrast,
  hostContrast, resolveLayout, WIDGET_LAYOUT_OPTIONS, resolveStayLayout, STAY_LAYOUT_OPTIONS } from "./widget-theme";

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
    expect(vars["--widget-accent" as keyof typeof vars]).toBe("#17171a");
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

describe("effectiveContrast", () => {
  it("no overrides → safe ratio (guard moot)", () => {
    expect(effectiveContrast({ ...WIDGET_THEME_DEFAULTS, theme: "light" })).toBeGreaterThanOrEqual(4.5);
  });

  it("background-only override on light collides with the default text colour", () => {
    // light default text is #18181b — overriding background to the same
    // colour should be caught even though `text` was never touched.
    const ratio = effectiveContrast({
      ...WIDGET_THEME_DEFAULTS, theme: "light", background: "#18181b",
    });
    expect(ratio).toBeCloseTo(1, 0);
  });

  it("text-only override on dark collides with the default background colour", () => {
    // dark default background is #18181b — overriding text to the same
    // colour should be caught even though `background` was never touched.
    const ratio = effectiveContrast({
      ...WIDGET_THEME_DEFAULTS, theme: "dark", text: "#18181b",
    });
    expect(ratio).toBeCloseTo(1, 0);
  });

  it("auto returns the worse of the light/dark variants", () => {
    // Background overridden to the dark theme's default (#18181b): fine
    // against the light variant's default text, but collides against the
    // dark variant's default text (#fafafa is fine, but here we pin text
    // too, to a colour that only collides in one variant).
    const ratio = effectiveContrast({
      ...WIDGET_THEME_DEFAULTS, theme: "auto", background: "#18181b",
    });
    // Light-variant text default (#18181b) sits on a #18181b background →
    // ~1:1; dark-variant text default (#fafafa) on #18181b → high contrast.
    // The worse (lower) of the two must win.
    expect(ratio).toBeCloseTo(1, 0);
  });

  it("auto with no overrides stays safe", () => {
    expect(effectiveContrast({ ...WIDGET_THEME_DEFAULTS, theme: "auto" })).toBeGreaterThanOrEqual(4.5);
  });
});

describe("hostContrast", () => {
  const base = { ...WIDGET_THEME_DEFAULTS };
  it("light widget on a dark host: no painted background, so text meets the host (fails)", () => {
    const r = hostContrast({ ...base, theme: "light" }, "dark", "#111214");
    expect(r).toBeLessThan(3);
  });
  it("light widget on a light host is fine", () => {
    expect(hostContrast({ ...base, theme: "light" }, "light", "#ffffff")).toBeGreaterThan(10);
  });
  it("auto resolves to the host, so it always reads well without overrides", () => {
    expect(hostContrast({ ...base, theme: "auto" }, "dark", "#111214")).toBeGreaterThan(10);
    expect(hostContrast({ ...base, theme: "auto" }, "light", "#ffffff")).toBeGreaterThan(10);
  });
  it("a background override paints its own surface, so the host no longer matters", () => {
    const r = hostContrast({ ...base, theme: "light", background: "#ffffff" }, "dark", "#111214");
    expect(r).toBeGreaterThan(10);
  });
  it("a text override is what meets the host", () => {
    const r = hostContrast({ ...base, theme: "dark", text: "#111111" }, "dark", "#111214");
    expect(r).toBeLessThan(1.5);
  });
});

describe("widget layout (widget templates, 2026-09-02)", () => {
  it("parses a known layout, drops an unknown one, and leaves it absent when never chosen", () => {
    expect(parseWidgetTheme({ layout: "week-columns" }).layout).toBe("week-columns");
    expect(parseWidgetTheme({ layout: "carousel" }).layout).toBeUndefined();
    expect(parseWidgetTheme({}).layout).toBeUndefined();
    expect(parseWidgetTheme(null).layout).toBeUndefined();
  });
  it("resolves to the calendar when nothing was chosen — the default template", () => {
    expect(resolveLayout(parseWidgetTheme({}))).toBe("calendar");
    expect(resolveLayout(parseWidgetTheme({ layout: "next-available" }))).toBe("next-available");
  });
  it("offers the four presentations, calendar first (named in messages: studio.layouts)", () => {
    expect(WIDGET_LAYOUT_OPTIONS.map((o) => o.value)).toEqual(["calendar", "week-list", "week-columns", "next-available"]);
  });
});

describe("stays layout (widget templates spec §8)", () => {
  it("parses a known stays layout, drops an unknown one, leaves it absent when never chosen", () => {
    expect(parseWidgetTheme({ stayLayout: "fields" }).stayLayout).toBe("fields");
    expect(parseWidgetTheme({ stayLayout: "three-months" }).stayLayout).toBeUndefined();
    expect(parseWidgetTheme({}).stayLayout).toBeUndefined();
  });
  it("resolves to one month when nothing was chosen", () => {
    expect(resolveStayLayout(parseWidgetTheme({}))).toBe("one-month");
    expect(resolveStayLayout(parseWidgetTheme({ stayLayout: "next-free" }))).toBe("next-free");
  });
  it("offers the four stays presentations, one month first (named in messages: studio.stayLayouts)", () => {
    expect(STAY_LAYOUT_OPTIONS.map((o) => o.value)).toEqual(["one-month", "two-months", "fields", "next-free"]);
  });
});
