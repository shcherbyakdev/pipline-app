"use client";

import * as React from "react";
import Link from "next/link";
import { NextIntlClientProvider, useTranslations, type AbstractIntlMessages } from "next-intl";
import type { Locale } from "@/i18n/config";
import { badgeShows } from "@/lib/billing/entitlements";
import { resolveLayout, resolveStayLayout, type WidgetThemeConfig } from "@/lib/widget-theme";
import { PageIntro } from "@/components/shell/page-header";
import { previewFor } from "@/features/orgs/embed-preview";
import { pickTarget, type EmbedPick, type ShowOptions } from "@/features/orgs/link-rows";
import type { OrgMode } from "@/features/orgs/mode";
import type { ClientContact } from "@/features/orgs/schema";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { PREVIEW_AVAILABILITY } from "@/features/rentals/preview-availability";
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import { EmbedCode } from "./embed-code";
import { EmbedPreviewFrame } from "./embed-preview-frame";
import type { EmbedTitles } from "./widget-embed-snippet";

/* Website embed (design once, share once — spec 2026-09-16): the studio's
   shape, minus anything to save. The snippet on the left; the widget on a
   mock host page on the right, following it. The widget's look is the
   booking page's own (Booking page › Style) — this page stores nothing.
   Show, Language and Theme are part of the string you copy. */
export function WidgetAppearance({
  previewMessages,
  orgLocale,
  orgTimeZone,
  clientContact,
  theme,
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
  options,
  initialPick,
  canHideBadge = true,
}: {
  /** The public messages per language: the preview speaks the language the
      snippet pins, else the org's (Settings › Business › Language). */
  previewMessages: Record<Locale, AbstractIntlMessages>;
  orgLocale: Locale;
  orgTimeZone: string;
  /** What the form asks the client for (Settings → Business), so the preview matches the live embed. */
  clientContact: ClientContact;
  /** The booking page's widget look (orgs.page_theme) — the one look everywhere. */
  theme: WidgetThemeConfig;
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
  mode: OrgMode;
  /** The iframe titles in the org's language (public.embedTitle.*). */
  titles: EmbedTitles;
  /** What the Show select offers (showOptions) and where it opens (the
      Team / Service / Space pages' Embed links land here preselected). */
  options: ShowOptions;
  initialPick: EmbedPick;
  /** Whether the plan lets the badge hide (lib/billing/badge-toggle.ts). */
  canHideBadge?: boolean;
}) {
  const t = useTranslations("embed");
  const [pick, setPick] = React.useState<EmbedPick>(initialPick);

  // What the PUBLIC embed will render: the page's look, the snippet's theme
  // over it, and badgeShows — the same rule the page and the emails apply —
  // so a saved "hide" the plan no longer allows is ignored here exactly as
  // it is out there.
  const pinned = pick.theme === "light" || pick.theme === "dark" ? { theme: pick.theme as "light" | "dark" } : null;
  const config: WidgetThemeConfig = { ...theme, ...pinned, hidePoweredBy: !badgeShows(theme.hidePoweredBy, canHideBadge) };
  const target = pickTarget(pick, options);
  const preview = previewFor(target, { services: previewServices, offerings: previewOfferings, staff, serviceStaffIds });
  const previewLocale = (pick.lang || orgLocale) as Locale;

  return (
    <div className="flex flex-col gap-5">
      <PageIntro>{t("paste")}</PageIntro>
      {/* Controls stay a narrow column; the preview gets the room, since
          judging the widget in context is the point of this page. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {handle ? (
            <EmbedCode appUrl={appUrl} handle={handle} options={options} pick={pick} onPick={setPick} mode={mode} titles={titles} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t.rich("noHandle", {
                link: (chunks) => (
                  <Link href="/settings" className="underline underline-offset-3 hover:text-foreground">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
        </div>
        {/* Sticks inside the shell panel's scroll container (the intro row
            sits above it), so the offset is just the content padding. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <EmbedPreviewFrame config={config} accentColor={accentColor}>
            {/* Only the widget speaks the snippet's language; the frame around
                it is admin chrome and keeps the admin's messages. */}
            <NextIntlClientProvider locale={previewLocale} messages={previewMessages[previewLocale]} timeZone={orgTimeZone}>
              <div lang={previewLocale} className="contents">
                <BookingWidget
                  // A new target, language or theme is a new embed: start it
                  // over, the way a pasted snippet would.
                  key={`${JSON.stringify(target)}:${previewLocale}:${pick.theme}`}
                  handle="preview"
                  orgTimeZone={orgTimeZone}
                  currency={currency}
                  clientContact={clientContact}
                  layout={resolveLayout(config)}
                  stayLayout={resolveStayLayout(config)}
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
    </div>
  );
}
