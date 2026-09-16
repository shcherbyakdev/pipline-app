"use client";

import { useTranslations } from "next-intl";
import { AppearanceFields } from "@/features/orgs/components/appearance-fields";
import { SettingsCard } from "@/components/settings-row";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { LayoutToggle } from "./layout-toggle";
import type { PageDocument } from "../schema";

/* Style: what publishes with the page — its layout and the widget's look,
   which is the one look everywhere (the website embed reads it too; design
   once, share once, spec 2026-09-16). Address, timezone, language, logo and
   accent live on Settings and save on their own. */
export function SettingsTab({
  theme, onTheme, offersRentals, badge, layout, onLayout,
}: {
  theme: WidgetThemeConfig; onTheme: (next: WidgetThemeConfig) => void;
  /** Shows the stays layout: only an org that rents by the night or day has one. */
  offersRentals: boolean;
  /** Whether the badge may be hidden, and the door when it may not (lib/billing/badge-toggle.ts). */
  badge: { canHideBadge: boolean; upgradeHref: string | null };
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
