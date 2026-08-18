"use client";

import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { effectiveContrast, WIDGET_THEME_OPTIONS, type WidgetThemeConfig } from "@/lib/widget-theme";
import { EmbedPreviewFrame } from "./embed-preview-frame";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { PublicService } from "@/lib/booking/public";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { cn } from "@/lib/utils";
import { snippetFor } from "./widget-embed-snippet";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";

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

export function WidgetAppearance({
  initial,
  accentColor,
  handle,
  appUrl,
  previewServices,
  staffOptions = [],
  initialStaffSlug = null,
}: {
  initial: WidgetThemeConfig;
  accentColor: string | null;
  handle: string | null;
  appUrl: string;
  previewServices: PublicService[];
  // Only passed when the org has more than one active team member — a solo
  // provider never sees a "Book with" choice they can't make.
  staffOptions?: Array<{ slug: string; name: string }>;
  initialStaffSlug?: string | null;
}) {
  const [config, setConfig] = React.useState<WidgetThemeConfig>(initial);
  const [pending, startTransition] = React.useTransition();
  // "" = the whole team (the org-wide flow, byte-identical to the old snippet).
  const [staffSlug, setStaffSlug] = React.useState<string>(initialStaffSlug ?? "");
  const snippet = handle ? snippetFor(appUrl, handle, staffSlug || null) : "";

  // Show/guard the ratio as soon as EITHER side is overridden — a lone
  // override still gets checked against the theme's default for the other
  // side (effectiveContrast), not skipped until both are set.
  const hasOverride = Boolean(config.background || config.text);
  const ratio = hasOverride ? effectiveContrast(config) : null;
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
    navigator.clipboard.writeText(snippet);
    toast.success("Copied");
  };

  const dirty = JSON.stringify(config) !== JSON.stringify(initial);
  const selectClass =
    "border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

  const colourRow = (
    key: "background" | "text",
    id: string,
    label: string,
    fallback: string,
  ) => (
    <SettingsRow label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
          value={config[key] ?? fallback}
          disabled={pending}
          onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
        />
        {config[key] ? (
          <>
            <span className="font-mono text-xs">{config[key]}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={() => setConfig((c) => ({ ...c, [key]: undefined }))}
            >
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
    <div className="flex flex-col gap-6">
      {/* Controls stay a narrow column; the preview gets the room, since
          judging the widget in context is the point of this page. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <SettingsCard
          title="Widget style"
          description="Theme is shared with the booking page."
          footer={
            <>
              {dirty ? <span className="text-muted-foreground mr-auto text-xs">Unsaved changes</span> : null}
              <Button size="sm" onClick={save} disabled={pending || contrastBlocked || !dirty}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <SettingsRow label="Theme" htmlFor="wt-theme">
            <select
              id="wt-theme"
              className={selectClass}
              value={config.theme}
              disabled={pending}
              onChange={(e) => setConfig((c) => ({ ...c, theme: e.target.value as WidgetThemeConfig["theme"] }))}
            >
              {WIDGET_THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingsRow>
          <div className="grid grid-cols-2 divide-x">
            <SettingsRow label="Corner radius" htmlFor="wt-radius">
              <select
                id="wt-radius"
                className={selectClass}
                value={config.radius}
                disabled={pending}
                onChange={(e) => setConfig((c) => ({ ...c, radius: e.target.value as WidgetThemeConfig["radius"] }))}
              >
                {RADIUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
            <SettingsRow label="Font" htmlFor="wt-font">
              <select
                id="wt-font"
                className={selectClass}
                value={config.font}
                disabled={pending}
                onChange={(e) => setConfig((c) => ({ ...c, font: e.target.value as WidgetThemeConfig["font"] }))}
              >
                {FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </div>
          {colourRow("background", "wt-background", "Background override", "#ffffff")}
          <SettingsRow
            label="Text override"
            htmlFor="wt-text"
            hint={
              ratio !== null ? (
                <span
                  className={cn(
                    contrastBlocked ? "text-destructive" : contrastWarn ? "text-amber-600 dark:text-amber-500" : undefined,
                  )}
                >
                  Contrast {ratio.toFixed(1)}:1
                  {contrastBlocked
                    ? " — below 3:1, blocked. Pick more distinct colours."
                    : contrastWarn
                      ? " — below 4.5:1 (AA body text)."
                      : ""}
                </span>
              ) : (
                "Overrides paint the widget's own surface, so it no longer takes the host page's."
              )
            }
          >
            <div className="flex items-center gap-2">
              <input
                id="wt-text"
                type="color"
                className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
                value={config.text ?? "#0f172a"}
                disabled={pending}
                onChange={(e) => setConfig((c) => ({ ...c, text: e.target.value }))}
              />
              {config.text ? (
                <>
                  <span className="font-mono text-xs">{config.text}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() => setConfig((c) => ({ ...c, text: undefined }))}
                  >
                    Clear
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground text-xs">Theme default</span>
              )}
            </div>
          </SettingsRow>
          <div className="flex items-center gap-2 px-4 py-3">
            <input
              id="wt-hide-powered-by"
              type="checkbox"
              className="size-4"
              checked={config.hidePoweredBy}
              disabled={pending}
              onChange={(e) => setConfig((c) => ({ ...c, hidePoweredBy: e.target.checked }))}
            />
            <Label htmlFor="wt-hide-powered-by" className="text-xs font-medium">
              Hide &quot;Powered by Booklo&quot;
            </Label>
          </div>
        </SettingsCard>
        <div className="lg:sticky lg:top-[calc(52px+1.5rem)] lg:self-start">
          <EmbedPreviewFrame config={config} accentColor={accentColor}>
            <BookingWidget
              handle="preview"
              orgTimeZone="UTC"
              services={previewServices}
              preview={{ slots: PREVIEW_SLOTS }}
            />
          </EmbedPreviewFrame>
        </div>
      </div>
      {handle ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">Embed snippet</p>
          {staffOptions.length > 0 ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="wt-staff" className="text-xs font-medium">
                Book with
              </Label>
              <select
                id="wt-staff"
                className={cn(selectClass, "w-auto")}
                value={staffSlug}
                onChange={(e) => setStaffSlug(e.target.value)}
              >
                <option value="">Whole team</option>
                {staffOptions.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-xs">
                {staffSlug
                  ? "This snippet books that person only."
                  : "Clients pick who they book."}
              </span>
            </div>
          ) : null}
          <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs">
            {snippet}
          </pre>
          <div>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Set a booking page address on{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Booking page
          </Link>{" "}
          to get your embed code.
        </p>
      )}
    </div>
  );
}
