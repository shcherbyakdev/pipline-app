"use client";

import type { Locale } from "@/i18n/config";
import Link from "next/link";
import * as React from "react";
import { NextIntlClientProvider, useTranslations, type AbstractIntlMessages } from "next-intl";
import { toast } from "sonner";
import { updateSurfaceTheme } from "@/features/orgs/actions";
import { resolveLayout, resolveStayLayout, type WidgetThemeConfig } from "@/lib/widget-theme";
import { AppearanceFields, contrastOf } from "./appearance-fields";
// Pure module (no server-only import, no DB) — safe in a client component.
import { badgeShows } from "@/lib/billing/entitlements";
import { EmbedPreviewFrame } from "./embed-preview-frame";
import { EmbedCode } from "./embed-code";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { PublicOffering, PublicService } from "@/lib/booking/public";
import type { OrgMode } from "@/features/orgs/mode";
import type { LinkRow } from "@/features/orgs/link-rows";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import type { EmbedTitles } from "./widget-embed-snippet";
import { PREVIEW_AVAILABILITY } from "@/features/rentals/preview-availability";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";

type Tab = "code" | "style";
const TABS: readonly Tab[] = ["code", "style"];

/* Website embed, the studio's shape: Code / Style on the left, the widget on
   a mock host page on the right. Code is the page's one job and opens first;
   Style is the same appearance fields the studio's Settings tab renders,
   bound to the embed's own stored config (updateSurfaceTheme "embed"). */
export function WidgetAppearance({
  previewIntl,
  orgTimeZone,
  initial,
  accentColor,
  handle,
  currency,
  appUrl,
  previewServices,
  previewOfferings,
  mode,
  titles,
  rows,
  initialKey,
  canHideBadge = true,
  upgradeHref = null,
}: {
  /** The org's language and the public messages in it: the preview shows
      what a client sees, like the studio's (booking-page/page.tsx). */
  previewIntl: { locale: Locale; messages: AbstractIntlMessages };
  orgTimeZone: string;
  initial: WidgetThemeConfig;
  accentColor: string | null;
  handle: string | null;
  currency: string;
  appUrl: string;
  /** The org's preview catalogue (toPreviewCatalog): real active rows per
      channel the org sells, canned stand-ins where it has none yet. */
  previewServices: PublicService[];
  previewOfferings: PublicOffering[];
  /** Effective mode — names the iframe (embedTitle) so a space owner's site
      doesn't announce "Book an appointment". */
  mode: OrgMode;
  /** The iframe titles in the org's language (public.embedTitle.*). */
  titles: EmbedTitles;
  /** What the snippet can point at (linkRows) and which row a deep link opens on. */
  rows: readonly LinkRow[];
  initialKey: string;
  // Hiding "Powered by Booklo" is a paid perk (spec §5). Defaults to true, so
  // a caller that doesn't pass it — and the whole flag-off world — behaves
  // exactly as before. The server enforces it regardless (badgeVisible): this
  // only stops the toggle from looking like it works.
  canHideBadge?: boolean;
  /** Where a capped org goes to lift it (lib/billing/upgrade-path.ts) —
      the disabled toggle and its chip both lead there. null = no door. */
  upgradeHref?: string | null;
}) {
  const t = useTranslations("embed");
  const tc = useTranslations("common");
  const [tab, setTab] = React.useState<Tab>("code");
  const [config, setConfig] = React.useState<WidgetThemeConfig>(initial);
  const [pending, startTransition] = React.useTransition();

  const { blocked: contrastBlocked } = contrastOf(config);

  // What the PUBLIC page will actually render: badgeShows is the same rule
  // the page and the emails apply, so a saved "hide" the plan no longer
  // allows (an org that downgraded) is ignored here exactly as it is out
  // there — the studio must not promise a badge-free widget the visitor never
  // sees. The stored config is untouched: upgrade and the tick works again.
  const previewConfig = { ...config, hidePoweredBy: !badgeShows(config.hidePoweredBy, canHideBadge) };

  const save = () => {
    startTransition(async () => {
      const result = await updateSurfaceTheme({ surface: "embed", theme: config });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("saved"));
    });
  };

  const dirty = JSON.stringify(config) !== JSON.stringify(initial);

  return (
    // Controls stay a narrow column; the preview gets the room, since
    // judging the widget in context is the point of this page.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {/* Local-state tab strip (studio-tabs.tsx; there is no Tabs primitive). */}
        <div role="tablist" aria-label={t("tabs.label")} className={SEGMENTED_NAV_CLASS}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={segmentedItemClass(tab === id)}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>
        {/* Both panes stay mounted: Show / Language live in EmbedCode's own
            state and must survive a trip to Style and back. */}
        <div hidden={tab !== "code"} className="flex flex-col gap-4">
          {handle ? (
            <EmbedCode appUrl={appUrl} handle={handle} rows={rows} initialKey={initialKey} mode={mode} titles={titles} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t.rich("noHandle", {
                link: (chunks) => (
                  <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
        </div>
        <div hidden={tab !== "style"}>
          <SettingsCard
            title={t("style.title")}
            description={t("style.description")}
            footer={
              <>
                {dirty ? <span className="text-muted-foreground mr-auto text-xs">{tc("unsavedChanges")}</span> : null}
                <Button size="sm" onClick={save} disabled={pending || contrastBlocked || !dirty}>
                  {pending ? tc("saving") : tc("save")}
                </Button>
              </>
            }
          >
            <AppearanceFields
              idPrefix="wt"
              config={config}
              onChange={setConfig}
              pending={pending}
              offersRentals={mode.offersRentals}
              canHideBadge={canHideBadge}
              upgradeHref={upgradeHref}
            />
          </SettingsCard>
        </div>
      </div>
      {/* Sticks inside the shell panel's scroll container (the header row
          sits above it), so the offset is just the content padding. */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <EmbedPreviewFrame config={previewConfig} accentColor={accentColor}>
          {/* Only the widget speaks the org's language; the frame around it
              is admin chrome and keeps the admin's messages. */}
          <NextIntlClientProvider locale={previewIntl.locale} messages={previewIntl.messages} timeZone={orgTimeZone}>
            <div lang={previewIntl.locale} className="contents">
              <BookingWidget
                handle="preview"
                orgTimeZone="UTC"
                currency={currency}
                layout={resolveLayout(previewConfig)}
                stayLayout={resolveStayLayout(previewConfig)}
                services={previewServices}
                offerings={previewOfferings}
                preview={{ slots: PREVIEW_SLOTS, availability: PREVIEW_AVAILABILITY }}
              />
            </div>
          </NextIntlClientProvider>
        </EmbedPreviewFrame>
      </div>
    </div>
  );
}
