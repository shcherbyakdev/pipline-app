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
import { EmbedCode, type EmbedPick } from "./embed-code";
import { previewFor } from "@/features/orgs/embed-preview";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import type { OrgMode } from "@/features/orgs/mode";
import type { LinkRow } from "@/features/orgs/link-rows";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings-row";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type { EmbedTitles } from "./widget-embed-snippet";
import { PREVIEW_AVAILABILITY } from "@/features/rentals/preview-availability";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";

type Tab = "code" | "style";
const TABS: readonly Tab[] = ["code", "style"];

/* Website embed, the studio's shape: Code / Style on the left, the widget on
   a mock host page on the right. Code is the page's one job and opens first;
   Style is the same appearance fields the studio's Settings tab renders,
   bound to the embed's own stored config (updateSurfaceTheme "embed").

   The preview follows the code: whatever the Show and Language selects put
   in the snippet is what the widget beside it shows (previewFor mirrors the
   public embed's narrowing). Its style is the SAVED one on the Code tab —
   what a visitor gets if you paste now — and the draft on the Style tab. */
export function WidgetAppearance({
  previewMessages,
  orgLocale,
  orgTimeZone,
  initial,
  accentColor,
  handle,
  currency,
  appUrl,
  previewServices,
  previewOfferings,
  staff,
  serviceStaffIds,
  mode,
  titles,
  rows,
  initialKey,
  canHideBadge = true,
  upgradeHref = null,
}: {
  /** The public messages per language: the preview speaks the language the
      snippet pins, else the org's (Booking page › Settings › Language). */
  previewMessages: Record<Locale, AbstractIntlMessages>;
  orgLocale: Locale;
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
  /** The active roster and who offers what — a person's snippet narrows the
      preview the way the public embed narrows the widget. */
  staff: PublicStaff[];
  serviceStaffIds: Record<string, string[]>;
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
  const [pick, setPick] = React.useState<EmbedPick>({ key: initialKey, lang: "" });
  const [config, setConfig] = React.useState<WidgetThemeConfig>(initial);
  const [pending, startTransition] = React.useTransition();

  const { blocked: contrastBlocked } = contrastOf(config);

  // What the PUBLIC page will actually render: badgeShows is the same rule
  // the page and the emails apply, so a saved "hide" the plan no longer
  // allows (an org that downgraded) is ignored here exactly as it is out
  // there — the studio must not promise a badge-free widget the visitor never
  // sees. The stored config is untouched: upgrade and the tick works again.
  const shown = tab === "code" ? initial : config;
  const previewConfig = { ...shown, hidePoweredBy: !badgeShows(shown.hidePoweredBy, canHideBadge) };

  const row = rows.find((r) => r.key === pick.key) ?? rows[0];
  const preview = previewFor(row.target, { services: previewServices, offerings: previewOfferings, staff, serviceStaffIds });
  const previewLocale = (pick.lang || orgLocale) as Locale;

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
        <SegmentedTabs label={t("tabs.label")} value={tab} onChange={setTab} items={TABS.map((id) => ({ value: id, label: t(`tabs.${id}`) }))} />
        {/* Both panes stay mounted (hidden, not unmounted) so neither loses
            what was typed on a trip to the other. */}
        <div hidden={tab !== "code"} className="flex flex-col gap-4">
          {handle ? (
            <EmbedCode appUrl={appUrl} handle={handle} rows={rows} pick={pick} onPick={setPick} mode={mode} titles={titles} />
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
            description={t.rich("style.description", {
              link: (chunks) => (
                <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
                  {chunks}
                </Link>
              ),
            })}
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
          {/* Only the widget speaks the snippet's language; the frame around
              it is admin chrome and keeps the admin's messages. */}
          <NextIntlClientProvider locale={previewLocale} messages={previewMessages[previewLocale]} timeZone={orgTimeZone}>
            <div lang={previewLocale} className="contents">
              <BookingWidget
                // A new target or language is a new embed: start it over,
                // the way a pasted snippet would.
                key={`${row.key}:${previewLocale}`}
                handle="preview"
                orgTimeZone={orgTimeZone}
                currency={currency}
                layout={resolveLayout(previewConfig)}
                stayLayout={resolveStayLayout(previewConfig)}
                services={preview.services}
                offerings={preview.offerings}
                staff={staff}
                serviceStaffIds={serviceStaffIds}
                lockedStaff={preview.lockedStaff}
                requestedService={preview.requestedService}
                requestedOffering={preview.requestedOffering}
                preview={{ slots: PREVIEW_SLOTS, availability: PREVIEW_AVAILABILITY }}
              />
            </div>
          </NextIntlClientProvider>
        </EmbedPreviewFrame>
      </div>
    </div>
  );
}
