import React from "react";

export type WidgetThemeConfig = {
  theme: "light" | "dark" | "auto";
  radius: "none" | "subtle" | "round";
  font: "system" | "inter" | "dm-sans" | "lora" | "space-grotesk" | "ibm-plex-mono";
  background?: string; // #rrggbb
  text?: string; // #rrggbb
  hidePoweredBy: boolean;
};

export const WIDGET_THEME_DEFAULTS: WidgetThemeConfig = {
  theme: "auto",
  radius: "subtle",
  font: "system",
  hidePoweredBy: false,
};

export const WIDGET_FONT_IDS = [
  "system",
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
  vars["--widget-accent"] = accentColor || "#0f172a";

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
