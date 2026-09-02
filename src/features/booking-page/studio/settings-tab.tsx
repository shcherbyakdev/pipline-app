"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { updateSurfaceTheme } from "@/features/orgs/actions";
import { AppearanceFields, contrastOf } from "@/features/orgs/components/appearance-fields";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { SettingsCard } from "@/components/settings-row";
import type { WidgetThemeConfig } from "@/lib/widget-theme";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Saved-as-you-go settings: address + timezone, logo + accent, and the
   booking page's own widget appearance (spec 2026-09-02 §9 — the website
   embed keeps its own; saved on change, optimistic with rollback). */
export function SettingsTab({
  branding, scheduling, appUrl, theme, onTheme, offersRentals, badge, onPreviewAccent, onHandleInput,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string;
  theme: WidgetThemeConfig; onTheme: (next: WidgetThemeConfig) => void;
  /** Shows the stays layout: only an org that rents by the night or day has one. */
  offersRentals: boolean;
  /** Whether the badge may be hidden, and the door when it may not (lib/billing/badge-toggle.ts). */
  badge: { canHideBadge: boolean; upgradeHref: string | null };
  onPreviewAccent: (hex: string | null) => void; onHandleInput: (handle: string) => void;
}) {
  const t = useTranslations("studio.settings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [savingTheme, startSaveTheme] = React.useTransition();
  // What the server holds — the rollback point, and the colours kept while
  // a blocked pair is on screen.
  const savedRef = React.useRef<WidgetThemeConfig>(theme);
  // One optimistic saver for the whole appearance. A colour pair below the
  // 3:1 floor previews but is not sent (the server would refuse it) — the
  // row's own hint says why — while every other field still saves, with the
  // last saved colours in its place.
  const change = (next: WidgetThemeConfig) => {
    const previous = savedRef.current;
    onTheme(next);
    const toSave = contrastOf(next).blocked ? { ...next, background: previous.background, text: previous.text } : next;
    if (JSON.stringify(toSave) === JSON.stringify(previous)) return;
    startSaveTheme(async () => {
      try {
        const result = await updateSurfaceTheme({ surface: "page", theme: toSave });
        if (!result.ok) {
          onTheme(previous);
          toast.error(result.error);
        } else {
          savedRef.current = toSave;
          toast.success(tCommon("saved"));
        }
      } catch (error) {
        console.error("[booking-page] change threw:", error);
        onTheme(previous);
        toast.error(tErrors("generic"));
      }
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <SchedulingSettingsForm settings={scheduling} appUrl={appUrl} onHandleInput={onHandleInput} />
      <SettingsCard title={t("look")} description={t("lookHint")}>
        <BrandingForm settings={branding} onPreviewAccent={onPreviewAccent} />
      </SettingsCard>
      <SettingsCard title={t("widget")} description={t("widgetHint")}>
        <AppearanceFields
          idPrefix="bp"
          config={theme}
          onChange={change}
          pending={savingTheme}
          offersRentals={offersRentals}
          canHideBadge={badge.canHideBadge}
          upgradeHref={badge.upgradeHref}
        />
      </SettingsCard>
    </div>
  );
}
