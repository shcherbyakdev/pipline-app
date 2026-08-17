"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BrandingSettings } from "@/features/orgs/queries";
import type { getSchedulingSettings } from "@/features/orgs/queries";
import type { PublicService } from "@/lib/booking/public";
import { parseWidgetTheme, WIDGET_THEME_OPTIONS, effectiveContrast, type WidgetThemeConfig } from "@/lib/widget-theme";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { BrandedHeader } from "@/components/branded-header";
import { LivePreview, PreviewNotice, SchemeToggle, type Scheme } from "@/components/live-preview";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { WidgetTheme } from "@/components/widget-theme";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { BrandingForm } from "./branding-form";
import { cn } from "@/lib/utils";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Booking page studio: compact settings cards on the left, and on the right
   the hosted page as a visitor will see it — same composition as
   /book/[handle] (page in the widget theme, max-w-lg column, BrandedHeader,
   then the widget, transparent unless the org set a background). Accent and
   handle track the forms live, before saving. */
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
  // Colour overrides (set on Website embed) apply here too — surface a weak
  // pair the same way the embed page does, so it isn't missed on this page.
  const overrideRatio = theme.background || theme.text ? effectiveContrast(theme) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <SchedulingSettingsForm settings={scheduling} appUrl={appUrl} onHandleInput={setHandle} />
        <SettingsCard title="Look" description="Saved as you go.">
          <BrandingForm settings={branding} onPreviewAccent={setAccent} />
          <SettingsRow
            label="Theme"
            htmlFor="bp-theme"
            hint={
              <>
                Shared with the website embed; corner radius, font and colour overrides are on{" "}
                <Link href="/embed" className="hover:text-foreground underline underline-offset-3">
                  Website embed
                </Link>
                .
              </>
            }
          >
            <select
              id="bp-theme"
              className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
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
          </SettingsRow>
        </SettingsCard>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <LivePreview
          url={url}
          dark={resolved === "dark"}
          // Same shell as /book/[handle], resolved for the preview: scoping
          // .light/.dark here keeps it faithful whatever the admin's theme is.
          pageClassName={cn(resolved, "bg-background text-foreground")}
          desktopMaxWidth="max-w-lg"
          controls={
            // Always visible so the page's scheme is legible at a glance;
            // only switchable when the theme is Auto (a fixed theme cannot
            // change with the visitor's system).
            <SchemeToggle
              label="Visitor's system theme"
              value={resolved}
              onChange={setScheme}
              optionLabels={{ light: "Light system", dark: "Dark system" }}
              disabled={theme.theme !== "auto"}
              disabledReason={`Theme is fixed to ${theme.theme === "light" ? "Light" : "Dark"} — every visitor sees this. Set Theme to Auto to preview both.`}
            />
          }
          notices={
            overrideRatio !== null && overrideRatio < 4.5 ? (
              <PreviewNotice tone={overrideRatio < 3 ? "error" : "warn"}>
                The widget&apos;s colour overrides give {overrideRatio.toFixed(1)}:1 contrast
                {overrideRatio < 3 ? " — unreadable" : " — below 4.5:1 (AA body text)"}. Adjust them on{" "}
                <Link href="/embed" className="underline underline-offset-3">
                  Website embed
                </Link>
                .
              </PreviewNotice>
            ) : theme.theme === "auto" ? (
              <PreviewNotice tone="info">
                Auto follows each visitor&apos;s system setting; the page always matches, so both variants
                are readable — use the toggle above to see each.
              </PreviewNotice>
            ) : null
          }
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
        </LivePreview>
      </div>
    </div>
  );
}
