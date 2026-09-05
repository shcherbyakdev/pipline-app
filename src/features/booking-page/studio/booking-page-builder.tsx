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
import { PoweredByLabel } from "@/components/powered-by";
import { contrastOf } from "@/features/orgs/components/appearance-fields";
import { NextIntlClientProvider, useTranslations, type AbstractIntlMessages } from "next-intl";
import type { Locale } from "@/i18n/config";
import {
  LivePreview,
  PreviewNotice,
  SchemeToggle,
  type Scheme,
} from "@/components/live-preview";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { cn } from "@/lib/utils";
import { badgeShows } from "@/lib/billing/entitlements";
import { PageIntro } from "@/components/shell/page-header";
import { bookingPath, bookingUrl, hostLabel } from "@/lib/booking/url";
import { SECTION_TYPES, type PageDocument } from "../schema";
import {
  deepEqual,
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

/* The live page's "Powered by Booklo", drawn the way embed-preview-frame
   draws it: inside the preview's own provider, so it speaks the org's
   language rather than the admin's. */
function PreviewBadge() {
  return <p className="mt-2 text-center"><PoweredByLabel className="px-2 py-1" /></p>;
}

/* Booking page builder: Sections / Settings on the left, the hosted page as
   a visitor will see it on the right — the same PageRenderer + WidgetTheme
   composition as /[handle], fed by the draft and the unsaved settings. */
export function BookingPageBuilder({
  previewIntl,
  seed,
  branding,
  scheduling,
  appUrl,
  supabaseUrl,
  previewServices,
  previewOfferings,
  staff,
  serviceStaffIds,
  initialPage,
  pageSections,
  mode,
  channel,
  publicReachable,
  capped,
  starter,
  badge,
}: {
  /** The org's language and the public messages in it: the preview renders
      what a client sees (src/app/(dashboard)/booking-page/page.tsx). */
  previewIntl: { locale: Locale; messages: AbstractIntlMessages };
  /** What a new section starts with, in the org's language (defaults.ts SectionSeed). */
  seed: SectionSeed;
  branding: BrandingSettings;
  scheduling: SchedulingSettings;
  appUrl: string;
  supabaseUrl: string;
  previewServices: PublicService[];
  previewOfferings: PublicOffering[];
  staff: PublicStaff[];
  /** serviceId → eligible staff ids, so the preview's widget offers the same
      person switch a client gets (lib/booking/public.ts). */
  serviceStaffIds: Record<string, string[]>;
  initialPage: { draft: PageDocument; published: PageDocument | null };
  pageSections: PlanLimits["pageSections"];
  mode: OrgMode;
  channel: PageChannel;
  publicReachable: boolean;
  /** The plan hides this channel from the public page (channelReach); the
      publish bar warns and points at the door. */
  capped: { href: string | null } | null;
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
  // (resolved by the page from the `seed` namespace — never shipped to visitors).
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
  // The widget's look — its template, theme, corners, colours — publishes with
  // the page now (2026-09-04): picking one moves the preview, and reaches
  // clients only when Publish does. `savedTheme` is what the server holds.
  const [savedTheme, setSavedTheme] = React.useState<WidgetThemeConfig>(() =>
    parseWidgetTheme(branding.pageTheme),
  );
  const [theme, setTheme] = React.useState<WidgetThemeConfig>(savedTheme);
  const themeDirty = !deepEqual(theme, savedTheme);
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

  const onApplyLayout = (patch: LayoutPatch) => setTheme({ ...theme, ...patch });

  // Publish sends both halves: the look first (one row), then the document.
  const [savingTheme, startSaveTheme] = React.useTransition();
  const publish = () => {
    if (!themeDirty) {
      draft.publish();
      return;
    }
    startSaveTheme(async () => {
      // A colour pair below 3:1 previews but is never sent — the server
      // refuses it — so the last saved pair goes out instead, which is what
      // the row's own hint promises.
      const toSave = contrastOf(theme).blocked
        ? { ...theme, background: savedTheme.background, text: savedTheme.text }
        : theme;
      try {
        const result = await updateSurfaceTheme({ surface: "page", theme: toSave });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setSavedTheme(toSave);
        setTheme(toSave);
        draft.publish();
      } catch (error) {
        console.error("[booking-page] publish theme threw:", error);
        toast.error(tErrors("generic"));
      }
    });
  };

  // The look lives only in this component until Publish, so leaving would
  // drop it — the draft hook warns the same way for unsaved section edits.
  React.useEffect(() => {
    if (!themeDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [themeDirty]);

  const host = hostLabel(appUrl);
  const previewHandle = handle.trim() || "your-handle";
  const url = `${host}${bookingPath(previewHandle)}`;
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
    serviceStaffIds,
    offerings: previewOfferings,
    lockedStaff: null,
    supabaseUrl,
    mode: "preview",
    previewSlots: PREVIEW_SLOTS,
    crossLink: null,
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
      ? bookingUrl(appUrl, scheduling.handle)
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
      {/* One row instead of two: what this page is for on the left, the way
          out of the studio in the right corner. Pinned to the top of the
          panel's scroll container — Publish is reachable however far down the
          settings you are. `-mt-6 pt-6` stretches its ground up over the page's
          own top padding without moving the row; `-top-6` cancels that margin
          again when pinned, so the ground lands flush on the pane's edge and
          nothing scrolls through above it. */}
      <div className="bg-background sticky -top-6 z-20 -mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-6 pb-4">
        <PageIntro>{t("intro")}</PageIntro>
        <PublishBar
          status={draft.status}
          unpublished={draft.unpublished || themeDirty}
          busy={draft.busy || savingTheme}
          pageIssue={
            draft.issues[""] ? Object.values(draft.issues[""])[0] : undefined
          }
          liveUrl={liveUrl}
          capped={capped}
          onRetry={draft.retry}
          onPublish={() =>
            empties.length > 0 ? setConfirm("publish") : publish()
          }
          onDiscard={() => setConfirm("discard")}
        />
      </div>
      <ConfirmDialog
        open={confirm === "discard"}
        title={t("discard.title")}
        description={draft.published ? t("discard.toPublished") : t("discard.toDefault")}
        confirmLabel={t("discard.confirm")}
        destructive
        onConfirm={() => {
          setConfirm(null);
          draft.discard();
          setTheme(savedTheme);
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
          publish();
        }}
        onClose={() => setConfirm(null)}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {starter.fresh ? (
          <StarterDialog
            previewIntl={previewIntl}
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
              layout={draft.doc.layout}
              onLayout={(layout) => draft.update((d) => ({ ...d, layout }))}
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
            />
          )}
        </div>

        {/* Sticks inside the shell panel's scroll container, below the pinned
          header row (24px of padding + a 32px control + 16px below it). */}
        <div className="lg:sticky lg:top-[4.5rem] lg:self-start">
          <LivePreview
            url={url}
            dark={resolved === "dark"}
            // Same shell as /[handle], resolved for the preview: scoping
            // .light/.dark here keeps it faithful whatever the admin's theme is.
            pageClassName={cn(resolved, "bg-sidebar text-foreground")}
            desktopMaxWidth={pageContainerClass(draft.doc.layout)}
            // Everything that changes how this looks sits over the preview it
            // changes: the widget's layout, then the two view switches. A
            // fixed theme has nothing to flip — every visitor sees the one the
            // preview is already showing — so that switch only appears on
            // Auto, where it stands for the visitor's own system.
            controls={
              <>
                {/* A spaces page has layouts to pick once it has a real space
                    (spec §8); before that the starter's first-space step is it. */}
                {channel === "appointments" || previewOfferings.some((o) => o.id !== PREVIEW_OFFERING_ID) ? (
                  <StarterDialog
                    previewIntl={previewIntl}
                    variant="picker"
                    channel={channel}
                    ctx={ctx}
                    layout={theme.layout}
                    stayLayout={theme.stayLayout}
                    needsFirstItem={starter.needsFirstItem}
                    currency={scheduling.currency}
                    onApply={onApplyLayout}
                  />
                ) : null}
                {theme.theme === "auto" ? (
                  <SchemeToggle
                    label={t("preview.systemTheme")}
                    value={resolved}
                    onChange={setScheme}
                    optionLabels={{ light: t("preview.lightSystem"), dark: t("preview.darkSystem") }}
                  />
                ) : null}
              </>
            }
            notices={
              overrideRatio !== null && overrideRatio < 4.5 ? (
                <PreviewNotice tone={overrideRatio < 3 ? "error" : "warn"}>
                  {t.rich(overrideRatio < 3 ? "notice.contrastUnreadable" : "notice.contrastLow", {
                    ratio: overrideRatio,
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
                    {/* The live page's own footer badge (renderChannelPage
                        draws it outside the renderer), so the Settings switch
                        that hides it can be seen doing it. */}
                    {badgeShows(theme.hidePoweredBy, badge.canHideBadge) ? <PreviewBadge /> : null}
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
