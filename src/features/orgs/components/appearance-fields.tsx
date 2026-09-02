"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SettingsRow } from "@/components/settings-row";
import { cn } from "@/lib/utils";
import {
  effectiveContrast, STAY_LAYOUT_OPTIONS, WIDGET_LAYOUT_OPTIONS, WIDGET_THEME_OPTIONS, resolveLayout, resolveStayLayout, type WidgetThemeConfig,
} from "@/lib/widget-theme";

const RADIUS_OPTIONS: Array<{ value: WidgetThemeConfig["radius"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "round", label: "Round" },
];
const FONT_OPTIONS: Array<{ value: WidgetThemeConfig["font"]; label: string }> = [
  { value: "system", label: "System" },
  { value: "geist", label: "Geist" },
  { value: "inter", label: "Inter" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "lora", label: "Lora" },
  { value: "space-grotesk", label: "Space Grotesk" },
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
  const router = useRouter();
  const id = (s: string) => `${idPrefix}-${s}`;
  const set = (patch: Partial<WidgetThemeConfig>) => onChange({ ...config, ...patch });
  const { ratio, blocked, warn } = contrastOf(config);
  const select = <K extends "theme" | "radius" | "font">(key: K, idSuffix: string, options: ReadonlyArray<{ value: WidgetThemeConfig[K]; label: string }>) => (
    <select id={id(idSuffix)} className={SELECT_CLASS} value={config[key]} disabled={pending} onChange={(e) => set({ [key]: e.target.value } as Pick<WidgetThemeConfig, K>)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
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
              Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Theme default</span>
        )}
      </div>
    </SettingsRow>
  );
  return (
    <>
      <SettingsRow label="Theme" htmlFor={id("theme")}>{select("theme", "theme", WIDGET_THEME_OPTIONS)}</SettingsRow>
      <div className="grid grid-cols-2 divide-x">
        <SettingsRow label="Corner radius" htmlFor={id("radius")}>{select("radius", "radius", RADIUS_OPTIONS)}</SettingsRow>
        <SettingsRow label="Widget layout" htmlFor={id("layout")}>
          <select id={id("layout")} className={SELECT_CLASS} value={resolveLayout(config)} disabled={pending} onChange={(e) => set({ layout: e.target.value as WidgetThemeConfig["layout"] })}>
            {WIDGET_LAYOUT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingsRow>
        {offersRentals ? (
          <SettingsRow label="Stays layout" htmlFor={id("stay-layout")}>
            <select id={id("stay-layout")} className={SELECT_CLASS} value={resolveStayLayout(config)} disabled={pending} onChange={(e) => set({ stayLayout: e.target.value as WidgetThemeConfig["stayLayout"] })}>
              {STAY_LAYOUT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </SettingsRow>
        ) : null}
        <SettingsRow label="Font" htmlFor={id("font")}>{select("font", "font", FONT_OPTIONS)}</SettingsRow>
      </div>
      {colourRow("background", "Background override", "#ffffff")}
      {colourRow(
        "text",
        "Text override",
        "#17171a",
        ratio !== null ? (
          <span className={cn(blocked ? "text-destructive" : warn ? "text-amber-600 dark:text-amber-500" : undefined)}>
            Contrast {ratio.toFixed(1)}:1
            {blocked ? " — below 3:1, blocked. Pick more distinct colours." : warn ? " — below 4.5:1 (AA body text)." : ""}
          </span>
        ) : (
          "Overrides paint the widget's own surface, so it no longer takes the host page's."
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
          Hide &quot;Powered by Booklo&quot;
        </Label>
        {canHideBadge ? null : upgradeHref ? (
          <Link id={id("hide-powered-by-plan")} href={upgradeHref} className="border-brand/40 text-brand-text hover:bg-brand/10 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
            Premium
          </Link>
        ) : (
          <span id={id("hide-powered-by-plan")} className="border-brand/40 text-brand-text rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
            Premium
          </span>
        )}
      </div>
    </>
  );
}
