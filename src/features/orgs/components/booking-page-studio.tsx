"use client";

import * as React from "react";
import Link from "next/link";
import { ComputerIcon, Moon02Icon, SmartPhone01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import type { BrandingSettings } from "@/features/orgs/queries";
import type { getSchedulingSettings } from "@/features/orgs/queries";
import type { PublicService } from "@/lib/booking/public";
import { toast } from "sonner";
import { parseWidgetTheme, WIDGET_THEME_OPTIONS, type WidgetThemeConfig } from "@/lib/widget-theme";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { Label } from "@/components/ui/label";
import { BrandedHeader } from "@/components/branded-header";
import { BrowserFrame, Segmented } from "@/components/browser-frame";
import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { BrandingForm } from "./branding-form";
import { cn } from "@/lib/utils";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;
type Device = "desktop" | "mobile";
type Scheme = "light" | "dark";

/* Booking page studio: the two forms on the left, and on the right the hosted
   page as a visitor will see it — same composition as /book/[handle]
   (dark ground, max-w-lg column, BrandedHeader, then the widget, transparent
   unless the org set a background). Accent and handle track the forms live,
   before saving; the widget's own theme comes from Website embed. */
export function BookingPageStudio({
  branding,
  scheduling,
  appUrl,
  previewServices,
}: {
  branding: BrandingSettings;
  scheduling: SchedulingSettings;
  appUrl: string;
  previewServices: PublicService[];
}) {
  const [accent, setAccent] = React.useState<string | null>(branding.accentColor);
  const [handle, setHandle] = React.useState(scheduling.handle ?? "");
  const [device, setDevice] = React.useState<Device>("desktop");
  // Only consulted when the widget theme is Auto: the hosted page then follows
  // the visitor's system, which the preview lets you flip.
  const [scheme, setScheme] = React.useState<Scheme>("light");
  // The widget theme config is shared with Website embed; this page edits
  // only its `theme` and saves on change (the rest of the config is left as
  // is). Preview follows the local value immediately.
  const [theme, setTheme] = React.useState<WidgetThemeConfig>(() => parseWidgetTheme(branding.widgetTheme));
  const [savingTheme, startSaveTheme] = React.useTransition();
  const resolved: Scheme = theme.theme === "auto" ? scheme : theme.theme;

  const changeTheme = (value: WidgetThemeConfig["theme"]) => {
    const previous = theme;
    const next = { ...theme, theme: value };
    setTheme(next);
    startSaveTheme(async () => {
      const result = await updateWidgetTheme(next);
      if (!result.ok) {
        setTheme(previous);
        toast.error(result.error);
      } else toast.success("Theme saved");
    });
  };

  const host = appUrl.replace(/^https?:\/\//, "");
  const url = `${host}/book/${handle.trim() || "your-handle"}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-sm font-medium">Address &amp; timezone</h2>
          <SchedulingSettingsForm settings={scheduling} onHandleInput={setHandle} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
          <BrandingForm settings={branding} onPreviewAccent={setAccent} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-sm font-medium">Appearance</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bp-theme">Theme</Label>
            <select
              id="bp-theme"
              className="border-input h-9 max-w-72 rounded-md border bg-transparent px-3 text-sm"
              value={theme.theme}
              disabled={savingTheme}
              onChange={(e) => changeTheme(e.target.value as WidgetThemeConfig["theme"])}
            >
              {WIDGET_THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Saved on change. Shared with the website embed — corner radius, font and colour overrides are on{" "}
              <Link href="/embed" className="hover:text-foreground underline underline-offset-3">
                Website embed
              </Link>
              .
            </p>
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm font-medium">Live preview</p>
          <div className="flex items-center gap-2">
            {theme.theme === "auto" ? (
              <Segmented
                label="Visitor's system theme"
                value={scheme}
                onChange={setScheme}
                options={[
                  { value: "light", label: "Light system", icon: Sun01Icon },
                  { value: "dark", label: "Dark system", icon: Moon02Icon },
                ]}
              />
            ) : null}
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
        <BrowserFrame url={url} dark={resolved === "dark"}>
          {/* Same shell as /book/[handle], resolved for the preview: the page
              takes the widget theme, so scoping `.light`/`.dark` here keeps it
              faithful whatever the admin's own theme is. */}
          <div className={cn(resolved, "bg-background text-foreground flex justify-center px-6 py-6")}>
            <div
              className={cn(
                "flex w-full flex-col gap-6 transition-[max-width] duration-300",
                device === "mobile" ? "max-w-[360px]" : "max-w-lg",
              )}
            >
              <BrandedHeader orgName={branding.orgName} accentColor={accent} logoUrl={branding.logoUrl} />
              <WidgetTheme config={theme} accentColor={accent} transparent={!theme.background}>
                <BookingWidget
                  handle="preview"
                  orgTimeZone={scheduling.timezone}
                  services={previewServices}
                  preview={{ slots: PREVIEW_SLOTS }}
                />
              </WidgetTheme>
            </div>
          </div>
        </BrowserFrame>
        {theme.theme === "auto" ? (
          <p className="text-muted-foreground text-xs">
            Auto follows each visitor&apos;s system setting — use the toggle above to check both.
          </p>
        ) : null}
      </div>
    </div>
  );
}
