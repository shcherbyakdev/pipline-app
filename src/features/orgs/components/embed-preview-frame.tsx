"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ComputerIcon, Moon02Icon, SmartPhone01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { hostContrast, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { BrowserFrame, Segmented } from "@/components/browser-frame";
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
  const transparent = !config.background;
  const ratio = hostContrast(config, host, HOST_BG[host]);
  // Shown on the previewed host right now.
  const clash = transparent && ratio < 3;
  // A fixed theme with no background is a bet on the site's colour — say so
  // up front, not only once the user happens to flip the host toggle.
  const fixedRisk = transparent && (config.theme === "light" || config.theme === "dark");
  const autoRisk = transparent && config.theme === "auto";
  const themeLabel = config.theme === "light" ? "Light" : "Dark";
  const otherTheme = config.theme === "light" ? "Dark" : "Light";
  const opposite: Host = config.theme === "light" ? "dark" : "light";

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

      <BrowserFrame url="yourwebsite.com/book" dark={dark}>
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
      </BrowserFrame>
      {clash ? (
        <Notice tone="error">
          On a {host} page the {themeLabel} theme&apos;s text is unreadable ({ratio.toFixed(1)}:1) — the
          embed paints no background of its own. If your site is {host}, choose {otherTheme} (or Auto),
          or set a background colour so the widget brings its own surface.
        </Notice>
      ) : fixedRisk ? (
        <Notice tone="warn">
          {themeLabel} theme with no background: the widget takes your site&apos;s surface, so on a{" "}
          {opposite} site its text becomes unreadable. Fine if your site is {host} — otherwise choose{" "}
          {otherTheme}, or set a background colour. Preview a {opposite} page above to see it.
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
