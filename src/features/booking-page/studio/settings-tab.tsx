"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { updateWidgetTheme } from "@/features/orgs/actions";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import { GENERIC_WRITE_ERROR } from "@/lib/actions";
import { WIDGET_THEME_OPTIONS, type WidgetThemeConfig } from "@/lib/widget-theme";
import { SELECT_CLASS } from "./fields";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Saved-as-you-go settings: address + timezone, logo + accent, and the
   theme (shared with Website embed; saved on change, optimistic with
   rollback — the old studio's changeTheme). */
export function SettingsTab({
  branding, scheduling, appUrl, theme, onTheme, onPreviewAccent, onHandleInput,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string;
  theme: WidgetThemeConfig; onTheme: (next: WidgetThemeConfig) => void;
  onPreviewAccent: (hex: string | null) => void; onHandleInput: (handle: string) => void;
}) {
  const [savingTheme, startSaveTheme] = React.useTransition();
  const changeTheme = (value: WidgetThemeConfig["theme"]) => {
    const previous = theme;
    const next = { ...theme, theme: value };
    onTheme(next);
    startSaveTheme(async () => {
      try {
        const result = await updateWidgetTheme(next);
        if (!result.ok) {
          onTheme(previous);
          toast.error(result.error);
        } else toast.success("Theme saved");
      } catch (error) {
        console.error("[booking-page] changeTheme threw:", error);
        onTheme(previous);
        toast.error(GENERIC_WRITE_ERROR);
      }
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <SchedulingSettingsForm settings={scheduling} appUrl={appUrl} onHandleInput={onHandleInput} />
      <SettingsCard title="Look" description="Saved as you go.">
        <BrandingForm settings={branding} onPreviewAccent={onPreviewAccent} />
        <SettingsRow
          label="Theme"
          htmlFor="bp-theme"
          hint={
            <>
              Shared with the website embed; corner radius, font and colour overrides are on{" "}
              <Link href="/embed" className="hover:text-foreground underline underline-offset-3">Website embed</Link>.
            </>
          }
        >
          <select id="bp-theme" className={SELECT_CLASS} value={theme.theme} disabled={savingTheme} onChange={(e) => changeTheme(e.target.value as WidgetThemeConfig["theme"])}>
            {WIDGET_THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
