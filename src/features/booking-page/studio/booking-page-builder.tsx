"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type {
  BrandingSettings,
  getSchedulingSettings,
} from "@/features/orgs/queries";
import { updateSurfaceTheme } from "@/features/orgs/actions";
import type { OrgMode } from "@/features/orgs/mode";
import type {
  PublicOffering,
  PublicService,
  PublicStaff,
} from "@/lib/booking/public";
import type { PlanLimits } from "@/lib/billing/plans";
import {
  effectiveContrast,
  parseWidgetTheme,
  type WidgetThemeConfig,
} from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { createTranslator, NextIntlClientProvider, useTranslations, type AbstractIntlMessages } from "next-intl";
import type { Messages } from "use-intl/core";
import type { Locale } from "@/i18n/config";
import {
  LivePreview,
  PreviewNotice,
  SchemeToggle,
  type Scheme,
} from "@/components/live-preview";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { cn } from "@/lib/utils";
import { channelPath, channelUrl, hostLabel } from "@/lib/booking/url";
import { SECTION_TYPES, type PageDocument } from "../schema";
import {
  emptyVisibleSections,
  replaceSection,
  type EmptyContext,
} from "../doc-ops";
import type { SectionSeed } from "../defaults";
import type { PageChannel } from "../channel";
import { GHOST_KEYS, type PreviewChrome, type RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { SelectionProvider } from "../render/selection";
import { usePageDraft } from "./use-page-draft";
import { StudioTabs, type StudioTab } from "./studio-tabs";
import { ConfirmDialog } from "./confirm-dialog";
import { PublishBar } from "./publish-bar";
import { SectionsPanel } from "./sections-panel";
import { SectionInspector } from "./section-inspector";
import { SettingsTab } from "./settings-tab";
import { StarterDialog, type LayoutPatch } from "./starter-dialog";
import { PREVIEW_OFFERING_ID } from "@/lib/booking/preview-catalog";

type SchedulingSettings = NonNullable<
  Awaited<ReturnType<typeof getSchedulingSettings>>
>;

/* Booking page builder: Sections / Settings on the left, the hosted page as
   a visitor will see it on the right — the same PageRenderer + WidgetTheme
   composition as /[handle], fed by the draft and the unsaved settings. */
export function BookingPageBuilder({
  previewIntl,
  branding,
  scheduling,
  appUrl,
  supabaseUrl,
  previewServices,
  previewOfferings,
  staff,
  initialPage,
  pageSections,
  mode,
  channel,
  publicReachable,
  capped,
  crossLink,
  starter,
  badge,
}: {
  /** The org's language and the public messages in it: the preview renders
      what a client sees (src/app/(dashboard)/booking-page/page.tsx). */
  previewIntl: { locale: Locale; messages: AbstractIntlMessages };
  branding: BrandingSettings;
  scheduling: SchedulingSettings;
  appUrl: string;
  supabaseUrl: string;
  previewServices: PublicService[];
  previewOfferings: PublicOffering[];
  staff: PublicStaff[];
  initialPage: { draft: PageDocument; published: PageDocument | null };
  pageSections: PlanLimits["pageSections"];
  mode: OrgMode;
  channel: PageChannel;
  publicReachable: boolean;
  /** The plan hides this channel from the public page (channelReach); the
      publish bar warns and points at the door. */
  capped: { href: string | null } | null;
  crossLink: RenderContext["crossLink"];
  /** The starter (widget templates spec §5): opens on a fresh page;
      `needsFirstItem` when the page's channel has nothing bookable yet. */
  starter: { fresh: boolean; needsFirstItem: boolean };
  /** Badge toggle state for the Settings tab (lib/billing/badge-toggle.ts). */
  badge: { canHideBadge: boolean; upgradeHref: string | null };
}) {
  const t = useTranslations("studio");
  const tErrors = useTranslations("errors");
  const draft = usePageDraft(initialPage, channel);
  // The studio's chrome inside the preview — section chips and ghost
  // placeholders — in the ADMIN's words, handed down as data: the preview
  // subtree's provider speaks the org's language (public messages only).
  const chrome = React.useMemo<PreviewChrome>(
    () => ({
      sections: Object.fromEntries(
        SECTION_TYPES.map((type) => {
          const label = t(`sections.${type}.label`);
          return [type, { label, edit: t("frame.edit", { section: label }) }];
        }),
      ) as PreviewChrome["sections"],
      hidden: t("frame.hidden"),
      ghost: Object.fromEntries(GHOST_KEYS.map((key) => [key, t(`ghost.${key}`)])) as PreviewChrome["ghost"],
    }),
    [t],
  );
  // What a new section starts with is the org's content, so it is seeded in
  // the org's language — the preview's own messages, not the admin's.
  const seed = React.useMemo<SectionSeed>(() => {
    const tSeed = createTranslator({ locale: previewIntl.locale, messages: previewIntl.messages as Messages, namespace: "public.seed" });
    return { bookNow: tSeed("bookNow"), services: tSeed("services"), team: tSeed("team"), spaces: tSeed("spaces") };
  }, [previewIntl]);
  // Where focus lands once the starter closes (M4): the left panel itself,
  // not wherever the trap happened to leave it.
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [tab, setTab] = React.useState<StudioTab>("sections");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Row the list is hovering — the preview echoes it with its hover outline.
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<"discard" | "publish" | null>(
    null,
  );
  const [accent, setAccent] = React.useState<string | null>(
    branding.accentColor,
  );
  const [handle, setHandle] = React.useState(scheduling.handle ?? "");
  // Only consulted when the widget theme is Auto: the hosted page then follows
  // the visitor's system, which the preview lets you flip.
  const [scheme, setScheme] = React.useState<Scheme>("light");
  const [theme, setTheme] = React.useState<WidgetThemeConfig>(() =>
    parseWidgetTheme(branding.pageTheme),
  );
  const resolved: Scheme = theme.theme === "auto" ? scheme : theme.theme;
  // Auto resolved to the preview's scheme: `wt-auto` follows the admin's real
  // system (a media query), which the toggle can't flip.
  const previewTheme: WidgetThemeConfig =
    theme.theme === "auto" ? { ...theme, theme: resolved } : theme;

  const select = React.useCallback((id: string) => {
    setSelectedId(id);
    setTab("sections");
  }, []);
  const selection = React.useMemo(
    () => ({ selectedId, select, hoveredId }),
    [selectedId, select, hoveredId],
  );

  const [, startSaveLayout] = React.useTransition();
  // The widget templates are this page's own setting (spec §9) — they save
  // to the LIVE page at once (the page document is untouched).
  const onApplyLayout = (patch: LayoutPatch) => {
    const previous = theme;
    const next: WidgetThemeConfig = { ...theme, ...patch };
    setTheme(next);
    startSaveLayout(async () => {
      try {
        const result = await updateSurfaceTheme({ surface: "page", theme: next });
        if (!result.ok) {
          setTheme(previous);
          toast.error(result.error);
        } else toast.success(t("starter.applied"));
      } catch (error) {
        console.error("[booking-page] onApplyLayout threw:", error);
        setTheme(previous);
        toast.error(tErrors("generic"));
      }
    });
  };

  const host = hostLabel(appUrl);
  const previewHandle = handle.trim() || "your-handle";
  const url = `${host}${channelPath(previewHandle, channel)}`;
  const ctx: RenderContext = {
    org: {
      orgId: branding.orgId,
      orgName: branding.orgName,
      handle: previewHandle,
      timeZone: scheduling.timezone,
      currency: scheduling.currency,
    },
    branding: { accentColor: accent, logoUrl: branding.logoUrl },
    theme: previewTheme,
    services: previewServices,
    staff,
    offerings: previewOfferings,
    lockedStaff: null,
    supabaseUrl,
    mode: "preview",
    previewSlots: PREVIEW_SLOTS,
    crossLink,
    preview: chrome,
  };
  const selected = draft.doc.sections.find((s) => s.id === selectedId) ?? null;
  const emptyContext: EmptyContext = {
    serviceCount: previewServices.length,
    staffCount: staff.length,
    offeringCount: previewOfferings.length,
  };
  const empties = emptyVisibleSections(draft.doc, emptyContext);
  const liveUrl =
    scheduling.handle && publicReachable
      ? channelUrl(appUrl, scheduling.handle, channel)
      : null;

  // Colour overrides (set on Website embed) apply here too — surface a weak
  // pair the same way the embed page does, so it isn't missed on this page.
  const overrideRatio =
    theme.background || theme.text ? effectiveContrast(theme) : null;
  const embedRisk = !theme.background && theme.theme !== "auto";
  const embedLink = {
    link: (chunks: React.ReactNode) => (
      <Link href="/embed" className="underline underline-offset-3">
        {chunks}
      </Link>
    ),
  };

  return (
    <div className="flex flex-col gap-5">
      <PublishBar
        status={draft.status}
        unpublished={draft.unpublished}
        neverPublished={draft.published === null}
        busy={draft.busy}
        pageIssue={
          draft.issues[""] ? Object.values(draft.issues[""])[0] : undefined
        }
        liveUrl={liveUrl}
        capped={capped}
        onRetry={draft.retry}
        onPublish={() =>
          empties.length > 0 ? setConfirm("publish") : draft.publish()
        }
        onDiscard={() => setConfirm("discard")}
      />
      <ConfirmDialog
        open={confirm === "discard"}
        title={t("discard.title")}
        description={draft.published ? t("discard.toPublished") : t("discard.toDefault")}
        confirmLabel={t("discard.confirm")}
        destructive
        onConfirm={() => {
          setConfirm(null);
          draft.discard();
        }}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "publish"}
        title={t("publishEmpty.title", { count: empties.length })}
        description={t("publishEmpty.description", { sections: empties.map((s) => chrome.sections[s.type].label).join(", ") })}
        confirmLabel={t("publishBar.publish")}
        onConfirm={() => {
          setConfirm(null);
          draft.publish();
        }}
        onClose={() => setConfirm(null)}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {starter.fresh ? (
          <StarterDialog
            variant="starter"
            channel={channel}
            ctx={ctx}
            layout={theme.layout}
            stayLayout={theme.stayLayout}
            needsFirstItem={starter.needsFirstItem}
            currency={scheduling.currency}
            onApply={onApplyLayout}
            finalFocus={panelRef}
          />
        ) : null}
        <div ref={panelRef} tabIndex={-1} className="flex flex-col gap-4">
          <StudioTabs value={tab} onChange={setTab} />
          {tab === "settings" ? (
            <SettingsTab
              branding={branding}
              scheduling={scheduling}
              appUrl={appUrl}
              theme={theme}
              onTheme={setTheme}
              offersRentals={mode.offersRentals}
              badge={badge}
              onPreviewAccent={setAccent}
              onHandleInput={setHandle}
            />
          ) : selected ? (
            <SectionInspector
              section={selected}
              issues={draft.issues[selected.id] ?? {}}
              supabaseUrl={supabaseUrl}
              offerings={previewOfferings}
              onChange={(next) => draft.update((d) => replaceSection(d, next))}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <SectionsPanel
              draft={draft}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onHover={setHoveredId}
              pageSections={pageSections}
              mode={mode}
              seed={seed}
              templatePicker={
                // A spaces page has layouts to pick once it has a real space
                // (spec §8); before that the starter's first-space step is it.
                channel === "appointments" || previewOfferings.some((o) => o.id !== PREVIEW_OFFERING_ID) ? (
                  <StarterDialog
                    variant="picker"
                    channel={channel}
                    ctx={ctx}
                    layout={theme.layout}
                    stayLayout={theme.stayLayout}
                    needsFirstItem={starter.needsFirstItem}
                    currency={scheduling.currency}
                    onApply={onApplyLayout}
                  />
                ) : null
              }
            />
          )}
        </div>

        {/* Sticks inside the shell panel's scroll container (the header row sits
          above it), so the offset is just the content padding. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <LivePreview
            url={url}
            dark={resolved === "dark"}
            // Same shell as /[handle], resolved for the preview: scoping
            // .light/.dark here keeps it faithful whatever the admin's theme is.
            pageClassName={cn(resolved, "bg-background text-foreground")}
            desktopMaxWidth={pageContainerClass(draft.doc.layout)}
            controls={
              <SchemeToggle
                label={t("preview.systemTheme")}
                value={resolved}
                onChange={setScheme}
                optionLabels={{ light: t("preview.lightSystem"), dark: t("preview.darkSystem") }}
                disabled={theme.theme !== "auto"}
                disabledReason={theme.theme === "light" ? t("preview.themeFixedLight") : t("preview.themeFixedDark")}
              />
            }
            notices={
              overrideRatio !== null && overrideRatio < 4.5 ? (
                <PreviewNotice tone={overrideRatio < 3 ? "error" : "warn"}>
                  {t.rich(overrideRatio < 3 ? "notice.contrastUnreadable" : "notice.contrastLow", {
                    ratio: overrideRatio.toFixed(1),
                    ...embedLink,
                  })}
                </PreviewNotice>
              ) : embedRisk ? (
                <PreviewNotice tone="warn">
                  {t.rich(theme.theme === "light" ? "notice.embedRiskLight" : "notice.embedRiskDark", embedLink)}
                </PreviewNotice>
              ) : theme.theme === "auto" ? (
                <PreviewNotice tone="info">{t("notice.auto")}</PreviewNotice>
              ) : null
            }
          >
            <SelectionProvider value={selection}>
              <NextIntlClientProvider locale={previewIntl.locale} messages={previewIntl.messages} timeZone={scheduling.timezone}>
                <WidgetTheme
                  config={previewTheme}
                  accentColor={accent}
                  transparent
                  className="flex flex-col"
                >
                  <div lang={previewIntl.locale} className="contents">
                    <PageRenderer doc={draft.doc} ctx={ctx} />
                  </div>
                </WidgetTheme>
              </NextIntlClientProvider>
            </SelectionProvider>
          </LivePreview>
        </div>
      </div>
    </div>
  );
}
