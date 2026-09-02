import React from "react";

/* How the appointment widget shows free times — the widget "template"
   (spec 2026-09-02). An org setting shared by the hosted page and the
   website embed, next to theme / radius / font. */
export const SLOT_LAYOUTS = ["calendar", "week-list", "week-columns", "next-available"] as const;
export type SlotLayout = (typeof SLOT_LAYOUTS)[number];

/* How a stay (nights or days) is picked — the stays template (spec §8).
   Hourly spaces show start times, so they take SlotLayout instead. */
export const STAY_LAYOUTS = ["one-month", "two-months", "fields", "next-free"] as const;
export type StayLayout = (typeof STAY_LAYOUTS)[number];

export type WidgetThemeConfig = {
  theme: "light" | "dark" | "auto";
  radius: "none" | "subtle" | "round";
  font: "system" | "geist" | "inter" | "dm-sans" | "lora" | "space-grotesk" | "ibm-plex-mono";
  /** Absent = never chosen (the studio starter opens); resolveLayout
      renders it as the calendar. */
  layout?: SlotLayout;
  /** Same contract for stays; resolveStayLayout renders it as one month. */
  stayLayout?: StayLayout;
  background?: string; // #rrggbb
  text?: string; // #rrggbb
  hidePoweredBy: boolean;
};

/** The default template: calendar + times. */
export function resolveLayout(config: Pick<WidgetThemeConfig, "layout">): SlotLayout {
  return config.layout ?? "calendar";
}

/** The default stays template: one month. */
export function resolveStayLayout(config: Pick<WidgetThemeConfig, "stayLayout">): StayLayout {
  return config.stayLayout ?? "one-month";
}

/* The option tables below carry values only; their names and one-line
   descriptions live in messages (`studio.stayLayouts.<value>.*`,
   `studio.layouts.<value>.*`, `studio.themes.<value>`), read by the
   consumers through useTranslations("studio"). */
export const STAY_LAYOUT_OPTIONS: ReadonlyArray<{ value: StayLayout }> = [
  { value: "one-month" },
  { value: "two-months" },
  { value: "fields" },
  { value: "next-free" },
];

/** The starter's cards and the settings selects, calendar first. */
export const WIDGET_LAYOUT_OPTIONS: ReadonlyArray<{ value: SlotLayout }> = [
  { value: "calendar" },
  { value: "week-list" },
  { value: "week-columns" },
  { value: "next-available" },
];

export const WIDGET_THEME_DEFAULTS: WidgetThemeConfig = {
  theme: "auto",
  radius: "subtle",
  font: "system",
  hidePoweredBy: false,
};

// The bg/text pair each named theme paints when the corresponding override
// is absent — must mirror the .wt-light/.wt-dark/.wt-auto rules in
// globals.css. Used by effectiveContrast() to fill in whichever side of the
// pair the org didn't override, so a lone override can't slip an unreadable
// combination past the guard.
/** Theme choices as shown in the admin (Website embed and Booking page). */
export const WIDGET_THEME_OPTIONS: ReadonlyArray<{ value: WidgetThemeConfig["theme"] }> = [
  { value: "light" },
  { value: "dark" },
  { value: "auto" },
];

export const WIDGET_THEME_DEFAULT_COLORS = {
  light: { background: "#ffffff", text: "#18181b" },
  dark: { background: "#18181b", text: "#fafafa" },
} as const;

export const WIDGET_FONT_IDS = [
  "system",
  "geist",
  "inter",
  "dm-sans",
  "lora",
  "space-grotesk",
  "ibm-plex-mono",
] as const;

const THEME_VALUES = ["light", "dark", "auto"] as const;
const RADIUS_VALUES = ["none", "subtle", "round"] as const;

const RADIUS_MAP: Record<WidgetThemeConfig["radius"], string> = {
  none: "0px",
  subtle: "6px",
  round: "12px",
};

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export function parseWidgetTheme(raw: unknown): WidgetThemeConfig {
  if (raw === null || raw === undefined) {
    return { ...WIDGET_THEME_DEFAULTS };
  }

  if (typeof raw !== "object") {
    return { ...WIDGET_THEME_DEFAULTS };
  }

  const input = raw as Record<string, unknown>;
  const result: WidgetThemeConfig = { ...WIDGET_THEME_DEFAULTS };

  // Validate theme
  if (
    typeof input.theme === "string"
    && THEME_VALUES.includes(input.theme as (typeof THEME_VALUES)[number])
  ) {
    result.theme = input.theme as WidgetThemeConfig["theme"];
  }

  // Validate radius
  if (
    typeof input.radius === "string"
    && RADIUS_VALUES.includes(input.radius as (typeof RADIUS_VALUES)[number])
  ) {
    result.radius = input.radius as WidgetThemeConfig["radius"];
  }

  // Validate font
  if (
    typeof input.font === "string"
    && WIDGET_FONT_IDS.includes(input.font as (typeof WIDGET_FONT_IDS)[number])
  ) {
    result.font = input.font as WidgetThemeConfig["font"];
  }

  // Validate layouts — left absent (not defaulted) when never chosen.
  if (typeof input.layout === "string" && SLOT_LAYOUTS.includes(input.layout as SlotLayout)) {
    result.layout = input.layout as SlotLayout;
  }
  if (typeof input.stayLayout === "string" && STAY_LAYOUTS.includes(input.stayLayout as StayLayout)) {
    result.stayLayout = input.stayLayout as StayLayout;
  }

  // Validate background
  if (typeof input.background === "string" && HEX_REGEX.test(input.background)) {
    result.background = input.background;
  }

  // Validate text
  if (typeof input.text === "string" && HEX_REGEX.test(input.text)) {
    result.text = input.text;
  }

  // Validate hidePoweredBy
  if (typeof input.hidePoweredBy === "boolean") {
    result.hidePoweredBy = input.hidePoweredBy;
  }

  return result;
}

export function themeCssVars(
  config: WidgetThemeConfig,
  accentColor: string | null,
): React.CSSProperties {
  const vars: Record<string, string> = {};

  // Always include radius and accent (with fallback)
  vars["--widget-radius"] = RADIUS_MAP[config.radius];
  // No accent set: ink (the hosted page's --foreground, gumloop.com's
  // button), not a blue-leaning slate.
  vars["--widget-accent"] = accentColor || "#17171a";

  // Only include background and text if overridden
  if (config.background) {
    vars["--widget-bg"] = config.background;
  }
  if (config.text) {
    vars["--widget-text"] = config.text;
  }

  return vars as React.CSSProperties;
}

/**
 * Calculate WCAG 2.x contrast ratio between two hex colors.
 * Returns a value between 1 (same color) and 21 (maximum contrast).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = getLuminance(hexA);
  const luminanceB = getLuminance(hexB);

  const lMax = Math.max(luminanceA, luminanceB);
  const lMin = Math.min(luminanceA, luminanceB);

  return (lMax + 0.05) / (lMin + 0.05);
}

/**
 * Contrast ratio the widget will actually render, filling in whichever of
 * background/text the config *doesn't* override with that theme's default
 * (see WIDGET_THEME_DEFAULT_COLORS) — so a single override (e.g. background
 * only) is checked against the default it will actually sit next to, not
 * skipped just because the other side is unset.
 *
 * theme "auto" renders as light or dark depending on the visitor's system,
 * so both variants are computed and the WORSE (lower) ratio is returned —
 * the guard must hold in whichever variant the visitor lands on.
 *
 * When neither background nor text is overridden, the theme's own default
 * pair is used and returns a safe ratio (guard is moot either way).
 */
export function effectiveContrast(config: WidgetThemeConfig): number {
  if (!config.background && !config.text) return 21;

  if (config.theme === "auto") {
    const light = contrastRatio(
      config.background ?? WIDGET_THEME_DEFAULT_COLORS.light.background,
      config.text ?? WIDGET_THEME_DEFAULT_COLORS.light.text,
    );
    const dark = contrastRatio(
      config.background ?? WIDGET_THEME_DEFAULT_COLORS.dark.background,
      config.text ?? WIDGET_THEME_DEFAULT_COLORS.dark.text,
    );
    return Math.min(light, dark);
  }

  const defaults = WIDGET_THEME_DEFAULT_COLORS[config.theme];
  return contrastRatio(config.background ?? defaults.background, config.text ?? defaults.text);
}

/**
 * Contrast the widget will render against the surface it ACTUALLY sits on
 * when embedded. The embed paints no background unless one is overridden
 * (see /embed/[handle]), so without an override the text meets the host
 * page, not the theme's default background — a Light widget on a dark site
 * is unreadable even though its own light/dark pair is fine. `host` is the
 * page the widget is dropped into (the preview's toggle; in production the
 * real site), which is also what theme "auto" resolves to here.
 */
export function hostContrast(
  config: WidgetThemeConfig,
  host: "light" | "dark",
  hostBackground: string,
): number {
  const resolved = config.theme === "auto" ? host : config.theme;
  const text = config.text ?? WIDGET_THEME_DEFAULT_COLORS[resolved].text;
  const surface = config.background ?? hostBackground;
  return contrastRatio(surface, text);
}

function getLuminance(hex: string): number {
  // Parse hex to RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // Linearize sRGB channels
  const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  // Calculate relative luminance
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}
