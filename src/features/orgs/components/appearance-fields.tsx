"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PremiumChip } from "@/features/billing/components/premium-chip";
import { SettingsRow } from "@/components/settings-row";
import { cn } from "@/lib/utils";
import {
  effectiveContrast, SLOT_LAYOUTS, STAY_LAYOUTS, WIDGET_THEMES, resolveLayout, resolveStayLayout, type WidgetThemeConfig,
} from "@/lib/widget-theme";

const RADIUS_VALUES: ReadonlyArray<WidgetThemeConfig["radius"]> = ["none", "subtle", "round"];
/* Font names are never translated; "System" (no `label`) is. `latinOnly`
   marks the faces that ship no Cyrillic subset (i18n spec §3) — the picker
   says so beside them, since a Ukrainian page set in Geist falls back to the
   system font. */
const FONT_OPTIONS: ReadonlyArray<{ value: WidgetThemeConfig["font"]; label?: string; latinOnly?: true }> = [
  { value: "system" },
  { value: "geist", label: "Geist", latinOnly: true },
  { value: "inter", label: "Inter" },
  { value: "dm-sans", label: "DM Sans", latinOnly: true },
  { value: "lora", label: "Lora" },
  { value: "space-grotesk", label: "Space Grotesk", latinOnly: true },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
];
export const SELECT_CLASS =
  "border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/** The contrast the config would render; null while nothing is overridden. */
export function contrastOf(config: WidgetThemeConfig): { ratio: number | null; blocked: boolean; warn: boolean } {
  const ratio = config.background || config.text ? effectiveContrast(config) : null;
  return { ratio, blocked: ratio !== null && ratio < 3, warn: ratio !== null && ratio < 4.5 };
}

/* The widget's appearance, as rows inside a SettingsCard (spec 2026-09-02
   §9): theme, corners, the two layouts, font, the colour overrides with
   their contrast guard, the badge. Controlled and surface-agnostic — the
   Website embed page and the studio's Settings tab both render it, each
   bound to its own stored config and its own save model. */
export function AppearanceFields({
  idPrefix, config, onChange, pending = false, offersRentals, canHideBadge = true, upgradeHref = null,
}: {
  /** Distinct ids per surface, so two instances on one page never collide. */
  idPrefix: string;
  config: WidgetThemeConfig;
  onChange: (next: WidgetThemeConfig) => void;
  pending?: boolean;
  /** Shows the stays layout: only an org that rents by the night or day has one. */
  offersRentals: boolean;
  // Hiding "Powered by Booklo" is a paid perk (spec §5). Defaults to true, so
  // a caller that doesn't pass it — and the whole flag-off world — behaves
  // exactly as before. The server enforces it regardless (badgeVisible): this
  // only stops the toggle from looking like it works.
  canHideBadge?: boolean;
  /** Where a capped org goes to lift it (lib/billing/upgrade-path.ts) —
      the disabled toggle and its chip both lead there. null = no door. */
  upgradeHref?: string | null;
}) {
  const t = useTranslations("studio");
  const router = useRouter();
  const id = (s: string) => `${idPrefix}-${s}`;
  const set = (patch: Partial<WidgetThemeConfig>) => onChange({ ...config, ...patch });
  const { ratio, blocked, warn } = contrastOf(config);
  const select = <K extends "theme" | "radius" | "font" | "layout" | "stayLayout">(
    key: K, idSuffix: string, value: string, options: ReadonlyArray<{ value: string; label: string }>,
  ) => (
    <select id={id(idSuffix)} className={SELECT_CLASS} value={value} disabled={pending} onChange={(e) => set({ [key]: e.target.value } as Pick<WidgetThemeConfig, K>)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
  const colourRow = (key: "background" | "text", label: string, fallback: string, hint?: React.ReactNode) => (
    <SettingsRow label={label} htmlFor={id(key)} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          id={id(key)}
          type="color"
          className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
          value={config[key] ?? fallback}
          disabled={pending}
          onChange={(e) => set({ [key]: e.target.value })}
        />
        {config[key] ? (
          <>
            <span className="font-mono text-xs">{config[key]}</span>
            <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => set({ [key]: undefined })}>
              {t("appearance.clear")}
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">{t("appearance.themeDefault")}</span>
        )}
      </div>
    </SettingsRow>
  );
  const contrastHint =
    ratio === null ? t("appearance.overridesHint")
    : blocked ? t("appearance.contrastBlocked", { ratio: ratio })
    : warn ? t("appearance.contrastWarn", { ratio: ratio })
    : t("appearance.contrast", { ratio: ratio });
  return (
    <>
      <SettingsRow label={t("appearance.theme")} htmlFor={id("theme")}>
        {select("theme", "theme", config.theme, WIDGET_THEMES.map((value) => ({ value, label: t(`themes.${value}`) })))}
      </SettingsRow>
      <div className="grid grid-cols-2 divide-x">
        <SettingsRow label={t("appearance.radius")} htmlFor={id("radius")}>
          {select("radius", "radius", config.radius, RADIUS_VALUES.map((value) => ({ value, label: t(`appearance.radiusOptions.${value}`) })))}
        </SettingsRow>
        <SettingsRow label={t("appearance.layout")} htmlFor={id("layout")}>
          {select("layout", "layout", resolveLayout(config), SLOT_LAYOUTS.map((value) => ({ value, label: t(`layouts.${value}.label`) })))}
        </SettingsRow>
        {offersRentals ? (
          <SettingsRow label={t("appearance.stayLayout")} htmlFor={id("stay-layout")}>
            {select("stayLayout", "stay-layout", resolveStayLayout(config), STAY_LAYOUTS.map((value) => ({ value, label: t(`stayLayouts.${value}.label`) })))}
          </SettingsRow>
        ) : null}
        <SettingsRow label={t("appearance.font")} htmlFor={id("font")}>
          {select("font", "font", config.font, FONT_OPTIONS.map((o) => ({
            value: o.value,
            label: `${o.label ?? t("appearance.fontSystem")}${o.latinOnly ? ` · ${t("latinOnly")}` : ""}`,
          })))}
        </SettingsRow>
      </div>
      {colourRow("background", t("appearance.background"), "#fefefe")}
      {colourRow(
        "text",
        t("appearance.text"),
        "#252228",
        ratio !== null ? (
          <span className={cn(blocked ? "text-destructive" : warn ? "text-amber-600 dark:text-amber-500" : undefined)}>{contrastHint}</span>
        ) : (
          contrastHint
        ),
      )}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* A capped org's click on the box is a request to lift the cap,
            so it goes to the door instead of toggling (preventDefault
            keeps the box unchecked); a disabled input would swallow the
            click and teach nothing. No door = plainly disabled. */}
        <input
          id={id("hide-powered-by")}
          type="checkbox"
          className="size-4"
          checked={config.hidePoweredBy}
          disabled={pending || (!canHideBadge && !upgradeHref)}
          aria-describedby={canHideBadge ? undefined : id("hide-powered-by-plan")}
          onClick={(e) => {
            if (canHideBadge || !upgradeHref) return;
            e.preventDefault();
            router.push(upgradeHref);
          }}
          onChange={(e) => set({ hidePoweredBy: e.target.checked })}
        />
        <Label htmlFor={id("hide-powered-by")} className="text-xs font-medium">
          {t("appearance.hideBadge")}
        </Label>
        {canHideBadge ? null : <PremiumChip id={id("hide-powered-by-plan")} href={upgradeHref} label={t("appearance.premium")} />}
      </div>
    </>
  );
}
