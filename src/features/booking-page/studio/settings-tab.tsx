"use client";

import { useTranslations } from "next-intl";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { AppearanceFields } from "@/features/orgs/components/appearance-fields";
import { BrandingForm } from "@/features/orgs/components/branding-form";
import { SchedulingSettingsForm } from "@/features/scheduling/components/scheduling-settings-form";
import { SettingsCard } from "@/components/settings-row";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { LayoutToggle } from "./layout-toggle";
import type { PageDocument } from "../schema";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Settings for the page itself: address + timezone, logo + accent, its layout
   and its widget's look. The last two are the page's own — they move the
   preview and go live with Publish (the builder holds them and sends them),
   which is why neither says "saved as you go". */
export function SettingsTab({
  branding, scheduling, appUrl, theme, onTheme, offersRentals, badge, onPreviewAccent, onHandleInput, layout, onLayout,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string;
  theme: WidgetThemeConfig; onTheme: (next: WidgetThemeConfig) => void;
  /** Shows the stays layout: only an org that rents by the night or day has one. */
  offersRentals: boolean;
  /** Whether the badge may be hidden, and the door when it may not (lib/billing/badge-toggle.ts). */
  badge: { canHideBadge: boolean; upgradeHref: string | null };
  onPreviewAccent: (hex: string | null) => void; onHandleInput: (handle: string) => void;
  /** The page's own layout: part of the draft document. */
  layout: PageDocument["layout"]; onLayout: (layout: PageDocument["layout"]) => void;
}) {
  const t = useTranslations("studio.settings");
  const tLayout = useTranslations("studio.layout");
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard title={tLayout("label")} description={t("pageLayoutHint")}>
        <div className="px-4 py-3">
          <LayoutToggle value={layout} onChange={onLayout} />
        </div>
      </SettingsCard>
      <SchedulingSettingsForm settings={scheduling} appUrl={appUrl} onHandleInput={onHandleInput} />
      <SettingsCard title={t("look")} description={t("lookHint")}>
        <BrandingForm settings={branding} onPreviewAccent={onPreviewAccent} />
      </SettingsCard>
      <SettingsCard title={t("widget")} description={t("widgetHint")}>
        <AppearanceFields
          idPrefix="bp"
          config={theme}
          onChange={onTheme}
          offersRentals={offersRentals}
          canHideBadge={badge.canHideBadge}
          upgradeHref={badge.upgradeHref}
        />
      </SettingsCard>
    </div>
  );
}
