"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ComputerIcon, Moon02Icon, SmartPhone01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { hostContrast, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { cn } from "@/lib/utils";

type Host = "light" | "dark";
type Device = "desktop" | "mobile";

/* Mock host page surfaces — must match the bg classes used in the frame
   below, since hostContrast() reads these to judge legibility. */
const HOST_BG: Record<Host, string> = { light: "#ffffff", dark: "#111214" };

/* Live preview for the website embed, shown the way embed configurators do
   it (Cal.com, Tally): the widget dropped into a mock host page inside a
   browser frame, so what you see is what a visitor sees — including the
   embed's transparent background sitting on the host's own surface.

   Two preview-only switches, neither of which is saved:
   - Host page light/dark. Also resolves the widget's "auto" theme, which in
     production follows the visitor's system (a media query the preview
     can't flip), so both outcomes can be checked before saving.
   - Desktop/mobile width, since the widget's slot grid reflows. */
export function EmbedPreviewFrame({
  config,
  accentColor,
  children,
}: {
  config: WidgetThemeConfig;
  accentColor: string | null;
  children: React.ReactNode;
}) {
  const [host, setHost] = React.useState<Host>("light");
  const [device, setDevice] = React.useState<Device>("desktop");

  const previewConfig: WidgetThemeConfig =
    config.theme === "auto" ? { ...config, theme: host } : config;
  const dark = host === "dark";

  // Legibility against the surface the widget really sits on. Only meaningful
  // while the embed is transparent — with a background override the widget
  // paints its own, and that pair is guarded by the contrast check next to
  // the colour pickers.
  const ratio = hostContrast(config, host, HOST_BG[host]);
  const clash = !config.background && ratio < 3;
  const themeLabel = config.theme === "light" ? "Light" : "Dark";
  const otherTheme = config.theme === "light" ? "Dark" : "Light";
  const autoRisk = config.theme === "auto" && !config.background;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">Live preview</p>
        <div className="flex items-center gap-2">
          <Segmented
            label="Host page"
            value={host}
            onChange={setHost}
            options={[
              { value: "light", label: "Light page", icon: Sun01Icon },
              { value: "dark", label: "Dark page", icon: Moon02Icon },
            ]}
          />
          <Segmented
            label="Device"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Desktop", icon: ComputerIcon },
              { value: "mobile", label: "Mobile", icon: SmartPhone01Icon },
            ]}
          />
        </div>
      </div>

      {/* Browser chrome — neutral greys, deliberately not our tokens, so the
          frame reads as "someone else's website" in either admin theme. */}
      <div
        className={cn(
          "overflow-hidden rounded-xl border shadow-[0_24px_60px_-28px_oklch(0_0_0/60%)]",
          dark ? "border-white/10 bg-[#111214]" : "border-black/10 bg-white",
        )}
      >
        <div
          className={cn(
            "flex h-10 items-center gap-3 border-b px-3",
            dark ? "border-white/10 bg-[#18191c]" : "border-black/8 bg-[#f4f4f5]",
          )}
        >
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div
            className={cn(
              "mx-auto flex h-6 w-full max-w-xs items-center justify-center rounded-md font-mono text-[11px]",
              dark ? "bg-white/8 text-white/50" : "bg-black/6 text-black/45",
            )}
          >
            yourwebsite.com/book
          </div>
          <span className="w-12" aria-hidden="true" />
        </div>

        {/* Host page: skeleton content around the widget so scale and
            contrast are judged in context, not on a bare card. */}
        <div
          className={cn(
            "flex justify-center px-6 py-8 transition-[background-color] sm:px-10",
            dark ? "bg-[#111214] text-white" : "bg-white text-black",
          )}
        >
          <div
            className={cn(
              "flex w-full flex-col gap-6 transition-[max-width] duration-300",
              device === "mobile" ? "max-w-[360px]" : "max-w-[640px]",
            )}
          >
            <Skeleton dark={dark} />
            <WidgetTheme
              config={previewConfig}
              accentColor={accentColor}
              transparent={!config.background}
              className="rounded-lg p-4"
            >
              {children}
              {config.hidePoweredBy ? null : (
                <p className="mt-4 text-center text-xs opacity-60">Powered by RolloutOS</p>
              )}
            </WidgetTheme>
            <Skeleton dark={dark} short />
          </div>
        </div>
      </div>
      {clash ? (
        <Notice tone="error">
          On a {host} page the {themeLabel} theme&apos;s text is unreadable ({ratio.toFixed(1)}:1) — the
          embed paints no background of its own. If your site is {host}, choose {otherTheme} (or Auto),
          or set a background colour so the widget brings its own surface.
        </Notice>
      ) : autoRisk ? (
        <Notice tone="warn">
          Auto follows each visitor&apos;s system setting, not your site&apos;s colours. On a site that is
          always light or always dark, some visitors will get the mismatched variant. Pick the theme that
          matches your site, or set a background colour. Switch the host page above to see both.
        </Notice>
      ) : null}
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <HugeiconsIcon icon={Alert02Icon} size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Skeleton({ dark, short = false }: { dark: boolean; short?: boolean }) {
  const bar = dark ? "bg-white/10" : "bg-black/8";
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      {short ? (
        <>
          <div className={cn("h-2.5 w-2/3 rounded-full", bar)} />
          <div className={cn("h-2.5 w-1/2 rounded-full", bar)} />
        </>
      ) : (
        <>
          <div className={cn("mb-1 h-5 w-1/2 rounded-md", bar)} />
          <div className={cn("h-2.5 w-full rounded-full", bar)} />
          <div className={cn("h-2.5 w-11/12 rounded-full", bar)} />
          <div className={cn("h-2.5 w-3/4 rounded-full", bar)} />
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon: React.ComponentProps<typeof HugeiconsIcon>["icon"] }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-secondary flex h-7 items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-6 items-center justify-center rounded-[4px] px-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={o.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}
