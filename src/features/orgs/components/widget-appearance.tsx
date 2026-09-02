"use client";

import Link from "next/link";
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateSurfaceTheme } from "@/features/orgs/actions";
import { resolveLayout, resolveStayLayout, type WidgetThemeConfig } from "@/lib/widget-theme";
import { AppearanceFields, SELECT_CLASS, contrastOf } from "./appearance-fields";
// Pure module (no server-only import, no DB) — safe in a client component.
import { badgeShows } from "@/lib/billing/entitlements";
import { EmbedPreviewFrame } from "./embed-preview-frame";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";
import type { PublicOffering, PublicService } from "@/lib/booking/public";
import type { OrgMode } from "@/features/orgs/mode";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings-row";
import { cn } from "@/lib/utils";
import { embedSnippet, type EmbedTitles } from "./widget-embed-snippet";
import { applyChannel, type Channel } from "@/lib/booking/channel";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import { SPACES } from "@/features/orgs/vocab";
import { PREVIEW_AVAILABILITY } from "@/features/rentals/preview-availability";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";

export function WidgetAppearance({
  initial,
  accentColor,
  handle,
  currency,
  appUrl,
  previewServices,
  previewOfferings,
  mode,
  titles,
  staffOptions = [],
  initialStaffSlug = null,
  canHideBadge = true,
  upgradeHref = null,
}: {
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
  // Only passed when the org has more than one active team member — a solo
  // provider never sees a "Book with" choice they can't make.
  staffOptions?: Array<{ slug: string; name: string }>;
  initialStaffSlug?: string | null;
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
  const [config, setConfig] = React.useState<WidgetThemeConfig>(initial);
  const [pending, startTransition] = React.useTransition();
  // "" = the whole team (the org-wide flow, byte-identical to the old snippet).
  const [staffSlug, setStaffSlug] = React.useState<string>(initialStaffSlug ?? "");
  // An embed is ONE channel (2026-09-02 ruling): a both-channel org picks
  // which one here — the snippet names it explicitly and the preview shows
  // only it. A single-channel org's snippet stays the plain one.
  const both = mode.offersAppointments && mode.offersRentals;
  const [channel, setChannel] = React.useState<Channel>(mode.offersAppointments ? "services" : "spaces");
  const target = channel === "services" && staffSlug ? { staff: staffSlug } : both ? { channel } : null;
  const snippet = handle ? embedSnippet(appUrl, handle, target, mode, titles) : "";
  const previewCatalog = applyChannel(
    { services: previewServices, staff: [] as never[], serviceStaffIds: {}, offerings: previewOfferings },
    both ? channel : null,
  );

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

  // Awaited: the clipboard write can be refused (permissions, insecure
  // context) and "Copied" must not claim otherwise (portal-links-panel.tsx).
  const copySnippet = async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyRefused"));
    }
  };

  const dirty = JSON.stringify(config) !== JSON.stringify(initial);
  const selectClass = SELECT_CLASS;

  return (
    <div className="flex flex-col gap-6">
      {/* The page's one job first: the snippet, in the first viewport —
          styling below is the refinement, not the point. */}
      {handle ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">{t("snippet")}</p>
          {both ? (
            <div role="radiogroup" aria-label={t("whichWidget")} className={cn(SEGMENTED_NAV_CLASS, "w-fit")}>
              {([["services", t("channelAppointments")], ["spaces", SPACES.widgetGroup]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={channel === value} onClick={() => setChannel(value)} className={segmentedItemClass(channel === value)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {staffOptions.length > 0 && channel === "services" ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="wt-staff" className="text-xs font-medium">
                {t("bookWith")}
              </Label>
              <select
                id="wt-staff"
                className={cn(selectClass, "w-auto")}
                value={staffSlug}
                onChange={(e) => setStaffSlug(e.target.value)}
              >
                <option value="">{t("wholeTeam")}</option>
                {staffOptions.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-xs">
                {staffSlug ? t("staffOnly") : t("clientsPick")}
              </span>
            </div>
          ) : null}
          <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs">
            {snippet}
          </pre>
          <div>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              {t("copy")}
            </Button>
          </div>
        </div>
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
      {/* Controls stay a narrow column; the preview gets the room, since
          judging the widget in context is the point of this page. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
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
        {/* Sticks inside the shell panel's scroll container (the header row
            sits above it), so the offset is just the content padding. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <EmbedPreviewFrame config={previewConfig} accentColor={accentColor}>
            <BookingWidget
              handle="preview"
              orgTimeZone="UTC"
              currency={currency}
              layout={resolveLayout(previewConfig)}
              stayLayout={resolveStayLayout(previewConfig)}
              services={previewCatalog.services}
              offerings={previewCatalog.offerings}
              preview={{ slots: PREVIEW_SLOTS, availability: PREVIEW_AVAILABILITY }}
            />
          </EmbedPreviewFrame>
        </div>
      </div>
    </div>
  );
}
