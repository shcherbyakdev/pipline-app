"use client";

import * as React from "react";
import { hostContrast, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { LivePreview, PreviewNotice, SchemeToggle, type Scheme } from "@/components/live-preview";
import { cn } from "@/lib/utils";

/* Mock host page surfaces — must match the classes in hostPageClass(),
   since hostContrast() reads these to judge legibility. */
const HOST_BG: Record<Scheme, string> = { light: "#ffffff", dark: "#111214" };
const hostPageClass = (host: Scheme) => (host === "dark" ? "bg-[#111214] text-white" : "bg-white text-black");

/* Live preview for the website embed: the widget dropped into a mock host
   page (skeleton content around it), so what you see is what a visitor sees
   — including the embed's transparent background sitting on the host's own
   surface. The host light/dark switch also resolves the widget's "auto"
   theme, which in production follows the visitor's system (a media query
   the preview can't flip). */
export function EmbedPreviewFrame({
  config,
  accentColor,
  children,
}: {
  config: WidgetThemeConfig;
  accentColor: string | null;
  children: React.ReactNode;
}) {
  const [host, setHost] = React.useState<Scheme>("light");
  const previewConfig: WidgetThemeConfig = config.theme === "auto" ? { ...config, theme: host } : config;
  const dark = host === "dark";

  // Legibility against the surface the widget really sits on. Only meaningful
  // while the embed is transparent — with a background override the widget
  // paints its own, and that pair is guarded by the contrast check next to
  // the colour pickers.
  const transparent = !config.background;
  const ratio = hostContrast(config, host, HOST_BG[host]);
  const clash = transparent && ratio < 3;
  const fixedRisk = transparent && (config.theme === "light" || config.theme === "dark");
  const autoRisk = transparent && config.theme === "auto";
  const themeLabel = config.theme === "light" ? "Light" : "Dark";
  const otherTheme = config.theme === "light" ? "Dark" : "Light";
  const opposite: Scheme = config.theme === "light" ? "dark" : "light";

  return (
    <LivePreview
      url="yourwebsite.com/book"
      dark={dark}
      pageClassName={hostPageClass(host)}
      controls={
        <SchemeToggle
          label="Host page"
          value={host}
          onChange={setHost}
          optionLabels={{ light: "Light page", dark: "Dark page" }}
        />
      }
      notices={
        clash ? (
          <PreviewNotice tone="error">
            On a {host} page the {themeLabel} theme&apos;s text is unreadable ({ratio.toFixed(1)}:1) — the
            embed paints no background of its own. If your site is {host}, choose {otherTheme} (or Auto), or
            set a background colour so the widget brings its own surface.
          </PreviewNotice>
        ) : fixedRisk ? (
          <PreviewNotice tone="warn">
            {themeLabel} theme with no background: the widget takes your site&apos;s surface, so on a{" "}
            {opposite} site its text becomes unreadable. Fine if your site is {host} — otherwise choose{" "}
            {otherTheme}, or set a background colour. Preview a {opposite} page above to see it.
          </PreviewNotice>
        ) : autoRisk ? (
          <PreviewNotice tone="warn">
            Auto follows each visitor&apos;s system setting, not your site&apos;s colours. On a site that is
            always light or always dark, some visitors will get the mismatched variant. Pick the theme that
            matches your site, or set a background colour. Switch the host page above to see both.
          </PreviewNotice>
        ) : null
      }
    >
      <Skeleton dark={dark} />
      <WidgetTheme config={previewConfig} accentColor={accentColor} transparent={transparent} className="rounded-lg p-4">
        {children}
        {config.hidePoweredBy ? null : <p className="mt-4 text-center text-xs opacity-60">Powered by RolloutOS</p>}
      </WidgetTheme>
      <Skeleton dark={dark} short />
    </LivePreview>
  );
}

/* Host page filler so scale and contrast are judged in context, not on a bare card. */
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
