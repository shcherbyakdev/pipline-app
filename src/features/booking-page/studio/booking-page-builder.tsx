"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { BrandingSettings, getSchedulingSettings } from "@/features/orgs/queries";
import { updateWidgetTheme } from "@/features/orgs/actions";
import type { OrgMode } from "@/features/orgs/mode";
import type { PublicOffering, PublicService, PublicStaff } from "@/lib/booking/public";
import type { PlanLimits } from "@/lib/billing/plans";
import { effectiveContrast, parseWidgetTheme, type WidgetThemeConfig } from "@/lib/widget-theme";
import { WidgetTheme } from "@/components/widget-theme";
import { LivePreview, PreviewNotice, SchemeToggle, type Scheme } from "@/components/live-preview";
import { PREVIEW_SLOTS } from "@/features/scheduling/preview-services";
import { cn } from "@/lib/utils";
import { channelPath, channelUrl, hostLabel } from "@/lib/booking/url";
import type { PageDocument } from "../schema";
import { replaceSection } from "../doc-ops";
import type { PageChannel } from "../channel";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { SelectionProvider } from "../render/selection";
import type { TemplateSkin } from "../templates";
import { STARTER } from "../copy";
import { usePageDraft } from "./use-page-draft";
import { StudioTabs, type StudioTab } from "./studio-tabs";
import { SectionsPanel } from "./sections-panel";
import { SectionInspector } from "./section-inspector";
import { SettingsTab } from "./settings-tab";
import { StarterDialog } from "./starter-dialog";
import { skinDefault } from "./starter-state";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

/* Booking page builder: Sections / Settings on the left, the hosted page as
   a visitor will see it on the right — the same PageRenderer + WidgetTheme
   composition as /[handle], fed by the draft and the unsaved settings. */
export function BookingPageBuilder({
  branding, scheduling, appUrl, supabaseUrl, previewServices, previewOfferings, staff, initialPage, pageSections, mode, channel, publicReachable, crossLink, starter,
}: {
  branding: BrandingSettings; scheduling: SchedulingSettings; appUrl: string; supabaseUrl: string;
  previewServices: PublicService[]; previewOfferings: PublicOffering[]; staff: PublicStaff[];
  initialPage: { draft: PageDocument; published: PageDocument | null };
  pageSections: PlanLimits["pageSections"]; mode: OrgMode; channel: PageChannel; publicReachable: boolean; crossLink: RenderContext["crossLink"];
  /** The starter (spec §5): opens on a fresh page; `needsFirstItem` when the
      page's channel has nothing bookable yet; `anyPublished` decides the
      look checkbox's default. */
  starter: { fresh: boolean; needsFirstItem: boolean; anyPublished: boolean };
}) {
  const draft = usePageDraft(initialPage, channel);
  // Where focus lands once the starter closes (M4): the left panel itself,
  // not wherever the trap happened to leave it.
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [tab, setTab] = React.useState<StudioTab>("sections");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [accent, setAccent] = React.useState<string | null>(branding.accentColor);
  const [handle, setHandle] = React.useState(scheduling.handle ?? "");
  // Only consulted when the widget theme is Auto: the hosted page then follows
  // the visitor's system, which the preview lets you flip.
  const [scheme, setScheme] = React.useState<Scheme>("light");
  const [theme, setTheme] = React.useState<WidgetThemeConfig>(() => parseWidgetTheme(branding.widgetTheme));
  const resolved: Scheme = theme.theme === "auto" ? scheme : theme.theme;
  // Auto resolved to the preview's scheme: `wt-auto` follows the admin's real
  // system (a media query), which the toggle can't flip.
  const previewTheme: WidgetThemeConfig = theme.theme === "auto" ? { ...theme, theme: resolved } : theme;

  const select = React.useCallback((id: string) => {
    setSelectedId(id);
    setTab("sections");
  }, []);
  const selection = React.useMemo(() => ({ selectedId, select }), [selectedId, select]);

  const [, startSaveSkin] = React.useTransition();
  const applySkin = (skin: TemplateSkin) => {
    // Theme/radius/font from the template; accent, logo, the badge setting
    // and any bg/text colour overrides (set on Website embed) stay the org's
    // own unless the skin itself defines them — this saves to the LIVE look,
    // so it must not silently wipe what the embed page was tuned to.
    const previous = theme;
    const next: WidgetThemeConfig = { ...theme, ...skin };
    setTheme(next);
    startSaveSkin(async () => {
      try {
        const result = await updateWidgetTheme(next);
        if (!result.ok) {
          setTheme(previous);
          toast.error("Template applied, but the look couldn't be saved.");
        }
      } catch (error) {
        console.error("[booking-page] applySkin threw:", error);
        setTheme(previous);
        toast.error("Template applied, but the look couldn't be saved.");
      }
    });
  };
  const onApplyTemplate = (next: PageDocument, skin: TemplateSkin | null) => {
    draft.update(next);
    setSelectedId(null);
    if (skin) applySkin(skin);
    toast.success(STARTER.applied);
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
    services: previewServices, staff, offerings: previewOfferings, lockedStaff: null,
    supabaseUrl, mode: "preview", previewSlots: PREVIEW_SLOTS,
    crossLink,
  };
  const selected = draft.doc.sections.find((s) => s.id === selectedId) ?? null;

  // Colour overrides (set on Website embed) apply here too — surface a weak
  // pair the same way the embed page does, so it isn't missed on this page.
  const overrideRatio = theme.background || theme.text ? effectiveContrast(theme) : null;
  const embedRisk = !theme.background && theme.theme !== "auto";
  const oppositeScheme: Scheme = theme.theme === "light" ? "dark" : "light";
  const oppositeLabel = theme.theme === "light" ? "Dark" : "Light";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      {starter.fresh ? (
        <StarterDialog
          variant="starter"
          channel={channel}
          doc={draft.doc}
          ctx={ctx}
          mode={mode}
          needsFirstItem={starter.needsFirstItem}
          applyLookDefault={skinDefault(starter.anyPublished)}
          currency={scheduling.currency}
          onApply={onApplyTemplate}
          finalFocus={panelRef}
        />
      ) : null}
      <div ref={panelRef} tabIndex={-1} className="flex flex-col gap-4">
        <StudioTabs value={tab} onChange={setTab} />
        {tab === "settings" ? (
          <SettingsTab branding={branding} scheduling={scheduling} appUrl={appUrl} theme={theme} onTheme={setTheme} onPreviewAccent={setAccent} onHandleInput={setHandle} />
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
            emptyContext={{ serviceCount: previewServices.length, staffCount: staff.length, offeringCount: previewOfferings.length }}
            liveUrl={scheduling.handle && publicReachable ? channelUrl(appUrl, scheduling.handle, channel) : null}
            pageSections={pageSections}
            mode={mode}
            templatePicker={
              <StarterDialog
                variant="picker"
                channel={channel}
                doc={draft.doc}
                ctx={ctx}
                mode={mode}
                needsFirstItem={starter.needsFirstItem}
                applyLookDefault={false}
                currency={scheduling.currency}
                onApply={onApplyTemplate}
              />
            }
          />
        )}
      </div>

      <div className="lg:sticky lg:top-[calc(52px+1.5rem)] lg:self-start">
        <LivePreview
          url={url}
          dark={resolved === "dark"}
          // Same shell as /[handle], resolved for the preview: scoping
          // .light/.dark here keeps it faithful whatever the admin's theme is.
          pageClassName={cn(resolved, "bg-background text-foreground")}
          desktopMaxWidth={pageContainerClass(draft.doc.layout)}
          controls={
            <SchemeToggle
              label="Visitor's system theme"
              value={resolved}
              onChange={setScheme}
              optionLabels={{ light: "Light system", dark: "Dark system" }}
              disabled={theme.theme !== "auto"}
              disabledReason={`Theme is fixed to ${theme.theme === "light" ? "Light" : "Dark"} — every visitor sees this. Set Theme to Auto to preview both.`}
            />
          }
          notices={
            overrideRatio !== null && overrideRatio < 4.5 ? (
              <PreviewNotice tone={overrideRatio < 3 ? "error" : "warn"}>
                The widget&apos;s colour overrides give {overrideRatio.toFixed(1)}:1 contrast
                {overrideRatio < 3 ? " — unreadable" : " — below 4.5:1 (AA body text)"}. Adjust them on{" "}
                <Link href="/embed" className="underline underline-offset-3">Website embed</Link>.
              </PreviewNotice>
            ) : embedRisk ? (
              <PreviewNotice tone="warn">
                This page is always readable — it paints its own {theme.theme} ground. But Theme is shared with the
                website embed, which takes your site&apos;s surface: on a {oppositeScheme} site its text becomes
                unreadable. If your site is {oppositeScheme}, choose {oppositeLabel} (or Auto), or set a background
                colour on <Link href="/embed" className="underline underline-offset-3">Website embed</Link>.
              </PreviewNotice>
            ) : theme.theme === "auto" ? (
              <PreviewNotice tone="info">
                Auto follows each visitor&apos;s system setting. This page always matches, so both variants are
                readable (use the toggle above). The website embed only matches if your site does too — check it there.
              </PreviewNotice>
            ) : null
          }
        >
          <SelectionProvider value={selection}>
            <WidgetTheme config={previewTheme} accentColor={accent} transparent className="flex flex-col">
              <PageRenderer doc={draft.doc} ctx={ctx} />
            </WidgetTheme>
          </SelectionProvider>
        </LivePreview>
      </div>
    </div>
  );
}
