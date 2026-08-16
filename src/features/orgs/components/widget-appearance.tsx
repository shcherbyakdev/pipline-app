"use client";

import * as React from "react";
import { toast } from "sonner";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { contrastRatio, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { PublicService } from "@/lib/booking/public";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { snippetFor } from "./widget-embed-snippet";

// Six slots across two future days, far in the future so this never needs
// to be refreshed to stay "future" for the preview widget.
const CANNED_SLOTS = [
  "2030-01-07T09:00:00.000Z",
  "2030-01-07T10:00:00.000Z",
  "2030-01-07T11:00:00.000Z",
  "2030-01-08T09:00:00.000Z",
  "2030-01-08T10:00:00.000Z",
  "2030-01-08T11:00:00.000Z",
];

const THEME_OPTIONS: Array<{ value: WidgetThemeConfig["theme"]; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto (match visitor's system)" },
];

const RADIUS_OPTIONS: Array<{ value: WidgetThemeConfig["radius"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "round", label: "Round" },
];

const FONT_OPTIONS: Array<{ value: WidgetThemeConfig["font"]; label: string }> = [
  { value: "system", label: "System" },
  { value: "inter", label: "Inter" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "lora", label: "Lora" },
  { value: "space-grotesk", label: "Space Grotesk" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
];

// create-booking-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

export function WidgetAppearance({
  initial,
  accentColor,
  handle,
  appUrl,
  previewServices,
}: {
  initial: WidgetThemeConfig;
  accentColor: string | null;
  handle: string | null;
  appUrl: string;
  previewServices: PublicService[];
}) {
  const [config, setConfig] = React.useState<WidgetThemeConfig>(initial);
  const [pending, startTransition] = React.useTransition();

  const ratio =
    config.background && config.text ? contrastRatio(config.background, config.text) : null;
  const contrastBlocked = ratio !== null && ratio < 3;
  const contrastWarn = ratio !== null && ratio < 4.5;

  const save = () => {
    startTransition(async () => {
      const result = await updateWidgetTheme(config);
      if (!result.ok) toast.error(result.error);
      else toast.success("Widget appearance saved");
    });
  };

  const copySnippet = () => {
    if (!handle) return;
    navigator.clipboard.writeText(snippetFor(appUrl, handle));
    toast.success("Copied");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wt-theme">Theme</Label>
            <select
              id="wt-theme"
              className={selectClass}
              value={config.theme}
              disabled={pending}
              onChange={(e) =>
                setConfig((c) => ({ ...c, theme: e.target.value as WidgetThemeConfig["theme"] }))
              }
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wt-radius">Corner radius</Label>
            <select
              id="wt-radius"
              className={selectClass}
              value={config.radius}
              disabled={pending}
              onChange={(e) =>
                setConfig((c) => ({ ...c, radius: e.target.value as WidgetThemeConfig["radius"] }))
              }
            >
              {RADIUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wt-font">Font</Label>
            <select
              id="wt-font"
              className={selectClass}
              value={config.font}
              disabled={pending}
              onChange={(e) =>
                setConfig((c) => ({ ...c, font: e.target.value as WidgetThemeConfig["font"] }))
              }
            >
              {FONT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wt-background">Background colour override</Label>
            <div className="flex items-center gap-2">
              <input
                id="wt-background"
                type="color"
                className="size-9 rounded border p-0.5"
                value={config.background ?? "#ffffff"}
                disabled={pending}
                onChange={(e) => setConfig((c) => ({ ...c, background: e.target.value }))}
              />
              {config.background ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfig((c) => ({ ...c, background: undefined }))}
                >
                  Clear
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">Using theme default</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wt-text">Text colour override</Label>
            <div className="flex items-center gap-2">
              <input
                id="wt-text"
                type="color"
                className="size-9 rounded border p-0.5"
                value={config.text ?? "#0f172a"}
                disabled={pending}
                onChange={(e) => setConfig((c) => ({ ...c, text: e.target.value }))}
              />
              {config.text ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfig((c) => ({ ...c, text: undefined }))}
                >
                  Clear
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">Using theme default</span>
              )}
            </div>
            {ratio !== null ? (
              <p
                className={cn(
                  "text-xs",
                  contrastBlocked
                    ? "text-destructive"
                    : contrastWarn
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-muted-foreground",
                )}
              >
                Contrast ratio: {ratio.toFixed(1)}:1
                {contrastBlocked
                  ? " — below 3:1, this combination is blocked. Pick more distinct colours."
                  : contrastWarn
                    ? " — below 4.5:1 (AA body text), consider more distinct colours."
                    : ""}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="wt-hide-powered-by"
              type="checkbox"
              className="size-4"
              checked={config.hidePoweredBy}
              disabled={pending}
              onChange={(e) => setConfig((c) => ({ ...c, hidePoweredBy: e.target.checked }))}
            />
            <Label htmlFor="wt-hide-powered-by">Hide &quot;Powered by RolloutOS&quot;</Label>
          </div>
          <div>
            <Button onClick={save} disabled={pending || contrastBlocked}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">Live preview</p>
          <div className="rounded-lg border p-4">
            <WidgetTheme config={config} accentColor={accentColor}>
              <BookingWidget
                handle="preview"
                orgTimeZone="UTC"
                services={previewServices}
                preview={{ slots: CANNED_SLOTS }}
              />
            </WidgetTheme>
          </div>
        </div>
      </div>
      {handle ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">Embed snippet</p>
          <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs">
            {snippetFor(appUrl, handle)}
          </pre>
          <div>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Publish a booking handle in Scheduling settings to get your embed code.
        </p>
      )}
    </div>
  );
}
