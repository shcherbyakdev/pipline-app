"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { Locale } from "@/i18n/config";

/** The org's language and the public messages in it (booking-page/page.tsx previewIntl). */
export type PreviewIntl = { locale: Locale; messages: AbstractIntlMessages };
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  DialogTrigger,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { WidgetTheme } from "@/components/widget-theme";
import { PREVIEW_OFFERING_ID } from "@/lib/booking/preview-catalog";
import { SLOT_LAYOUTS, STAY_LAYOUTS, type SlotLayout, type StayLayout, type WidgetThemeConfig } from "@/lib/widget-theme";
import { cn } from "@/lib/utils";
import { DEFAULT_PAGE } from "../defaults";
import type { PageChannel } from "../channel";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { initialStarterState, starterReducer, type StarterAction, type StarterState } from "./starter-state";
import { FirstServiceForm, FirstSpaceForm } from "./first-item-form";

type Group = "times" | "stays";
export type LayoutPatch = { layout?: SlotLayout; stayLayout?: StayLayout };

/* Full-size live preview: the real PageRenderer — the default page (name +
   widget) with the org's own name and catalogue — in the layouts the cards
   name, on canned slots and availability, opened straight on the first
   service or space of the group's kind, so what you see IS the widget you
   get. `inert` keeps the widget inside from taking focus or clicks. CSS
   `zoom` (not transform scale) so the shrunk page keeps a real layout
   height and the pane scrolls naturally. */
function LayoutPreview({ group, times, stays, ctx, channel, previewIntl }: { group: Group; times: SlotLayout; stays: StayLayout; ctx: RenderContext; channel: PageChannel; previewIntl: PreviewIntl }) {
  const scheme = ctx.theme.theme === "auto" ? "light" : ctx.theme.theme;
  const theme: WidgetThemeConfig = { ...ctx.theme, theme: scheme, layout: times, stayLayout: stays };
  const offering = ctx.offerings.find((o) => (group === "stays" ? o.rangeMode !== "hours" : o.rangeMode === "hours"));
  return (
    <div className="bg-muted/50 relative h-full overflow-x-hidden overflow-y-auto rounded-xl border">
      {/* aria-hidden/inert guard the page CONTENT (focus, clicks, AT) but
          must not sit on the scroll container itself — an inert scroller
          ignores the wheel and the pane cannot be scrolled at all. */}
      <div className={cn("pointer-events-none w-[760px] p-8", scheme, "bg-background text-foreground")} style={{ zoom: 0.8 }} aria-hidden inert>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass("column"))}>
            {/* What you see IS the widget you get — so it speaks the org's language. */}
            <NextIntlClientProvider locale={previewIntl.locale} messages={previewIntl.messages}>
              <div lang={previewIntl.locale} className="contents">
                <PageRenderer
                  key={`${group}-${channel}`}
                  doc={DEFAULT_PAGE}
                  ctx={{ ...ctx, theme, mode: "preview", crossLink: null }}
                  initialServiceId={channel === "appointments" ? (ctx.services[0]?.id ?? null) : null}
                  initialOfferingId={channel === "spaces" ? (offering?.id ?? null) : null}
                />
              </div>
            </NextIntlClientProvider>
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

/* The starter (widget templates spec 2026-09-02 §5, §8) and, in `picker`
   mode, the "Widget layout" dialog — one component, one reducer
   (starter-state.ts). Starter: opens itself on a fresh page and cannot be
   dismissed (Base UI 1.7 has no `dismissible`, so `open` is controlled and
   every `onOpenChange(false)` is ignored; a Leave link returns to Bookings
   — ruling 2's exit, reachable inside the focus trap). An appointments
   page asks for the times layout; a spaces page asks a group per kind it
   rents (times for hourly spaces, stays for nights and days), or opens
   straight on the first-space step when there is nothing to rent yet.
   Picker: a trigger button, dismissable; the layouts are org settings
   saved at once, so there is no draft to confirm replacing. */
export function StarterDialog({
  variant, channel, ctx, layout, stayLayout, needsFirstItem, currency, onApply, finalFocus, previewIntl,
}: {
  previewIntl: PreviewIntl;
  variant: "starter" | "picker";
  channel: PageChannel;
  ctx: RenderContext;
  /** The org's current choices, if any — the cards the previews open on. */
  layout: SlotLayout | undefined;
  stayLayout: StayLayout | undefined;
  needsFirstItem: boolean;
  currency: string;
  onApply: (patch: LayoutPatch) => void;
  finalFocus?: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("studio");
  const router = useRouter();
  const starter = variant === "starter";
  const real = ctx.offerings.filter((o) => o.id !== PREVIEW_OFFERING_ID);
  const groups: Group[] =
    channel === "appointments"
      ? ["times"]
      : [...(real.some((o) => o.rangeMode === "hours") ? (["times"] as Group[]) : []), ...(real.some((o) => o.rangeMode !== "hours") ? (["stays"] as Group[]) : [])];
  // The starter opens on the first-item step when that is all that is
  // missing: a spaces page with nothing to rent, or an appointments page
  // whose layout is already chosen. The picker always opens on the cards.
  const firstStep = starter && needsFirstItem && (channel === "spaces" || layout !== undefined) ? "firstItem" : "layout";
  const [open, setOpen] = React.useState(starter);
  const [state, setState] = React.useState<StarterState>(() => initialStarterState(firstStep));
  // What the preview pane shows — view state only; nothing is saved until
  // Continue / "Use this layout".
  const [times, setTimes] = React.useState<SlotLayout>(layout ?? "calendar");
  const [stays, setStays] = React.useState<StayLayout>(stayLayout ?? "one-month");
  const [activeGroup, setActiveGroup] = React.useState<Group>(groups[0] ?? "times");

  const reset = () => setState(initialStarterState(firstStep));
  const finish = (next: StarterState) => {
    const patch: LayoutPatch = {};
    if (next.layout) patch.layout = next.layout;
    if (next.stayLayout) patch.stayLayout = next.stayLayout;
    if (patch.layout || patch.stayLayout) onApply(patch);
    reset();
    setOpen(false);
  };
  const dispatch = (action: StarterAction) => {
    const next = starterReducer(state, action);
    setState(next);
    if (next.step === "done") finish(next);
  };
  const choose = () =>
    dispatch({ kind: "choose", layout: groups.includes("times") ? times : null, stayLayout: groups.includes("stays") ? stays : null, needsFirstItem });
  const onCreated = () => {
    // Close first — the route re-renders with the real service/space in the
    // preview catalogue, and the draft hook is seeded once, so refreshing
    // never resets the draft. Dispatching first keeps the close off the
    // server round trip.
    dispatch({ kind: "created" });
    router.refresh();
  };
  const onOpenChange: NonNullable<React.ComponentProps<typeof Dialog>["onOpenChange"]> = (next, details) => {
    if (starter && !next) {
      // The X is ruling 2's Leave exit; Esc/backdrop stay swallowed so an
      // accidental dismissal mid-flow never navigates away.
      if (details.reason === "close-press") router.push("/bookings");
      return;
    }
    setOpen(next);
    if (!next) reset();
  };

  const title = starter ? (channel === "appointments" ? t("starter.title") : t("starter.titleSpaces")) : t("starter.picker.title");
  const sub = starter ? t("starter.sub") : t("starter.picker.sub");
  const atFirstItem = state.step === "firstItem";
  // Back to the layout step only when there was one (an appointments starter).
  const onBack = state.layout || state.stayLayout ? () => dispatch({ kind: "back" }) : undefined;
  // Ruling 2's exit, reachable from inside the focus trap: leave the page,
  // never the step.
  const leaveButton = (
    <Button variant="ghost" size="sm" onClick={() => router.push("/bookings")}>
      {t("starter.leave")}
    </Button>
  );
  // The cards' words live in messages, keyed by layout value (widget-theme.ts
  // holds only the values).
  const timesOptions = SLOT_LAYOUTS.map((value) => ({ value, label: t(`layouts.${value}.label`), description: t(`layouts.${value}.description`) }));
  const staysOptions = STAY_LAYOUTS.map((value) => ({ value, label: t(`stayLayouts.${value}.label`), description: t(`stayLayouts.${value}.description`) }));

  const cardList = <T extends string>(
    group: Group,
    options: ReadonlyArray<{ value: T; label: string; description: string }>,
    value: T,
    current: T | undefined,
    onSelect: (v: T) => void,
    label: string,
  ) => (
    <div className="flex flex-col gap-1" role="listbox" aria-label={label}>
      {groups.length > 1 ? <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium">{label}</p> : null}
      {options.map((o) => {
        const selected = o.value === value && activeGroup === group;
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            onClick={() => {
              onSelect(o.value);
              setActiveGroup(group);
            }}
            className={cn(
              "focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2",
              selected ? "bg-secondary" : o.value === value ? "bg-muted/60" : "hover:bg-muted",
            )}
          >
            <span className="text-sm font-medium">
              {o.label}
              {o.value === current ? (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {t("starter.current")}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground text-xs">{o.description}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {starter ? null : (
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              {t("starter.picker.trigger")}
            </Button>
          }
        />
      )}
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-4xl")} finalFocus={finalFocus}>
        <DialogBreadcrumbHeader chip={<DialogChip>{t("name")}</DialogChip>}>
          {atFirstItem ? (channel === "appointments" ? t("starter.firstService.title") : t("starter.firstSpace.title")) : title}
        </DialogBreadcrumbHeader>
        {atFirstItem ? (
          <>
            <div className="flex flex-col px-5 pt-2 pb-6">
              <DialogDescription>
                {channel === "appointments" ? t("starter.firstService.sub") : t("starter.firstSpace.sub")}
              </DialogDescription>
              {!starter ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  {channel === "appointments" ? t("starter.firstService.why") : t("starter.firstSpace.why")}
                </p>
              ) : null}
              <div className="mt-5 flex flex-col">
                {channel === "appointments" ? (
                  <FirstServiceForm currency={currency} onCreated={onCreated} onBack={onBack} />
                ) : (
                  <FirstSpaceForm currency={currency} onCreated={onCreated} onBack={onBack} />
                )}
              </div>
            </div>
            {starter ? <DialogFooterBar className="sm:justify-start">{leaveButton}</DialogFooterBar> : null}
          </>
        ) : (
          <>
            <div className="flex flex-col px-5 pt-2 pb-5">
              <DialogDescription>{sub}</DialogDescription>
              {/* The gallery split: pick on the left, see the whole widget —
                  with the org's own name and catalogue — on the right.
                  Nothing saves until the footer CTA. */}
              <div className="mt-4 flex flex-col gap-3 sm:h-[58vh] sm:flex-row">
                <div className="flex shrink-0 flex-col gap-2 overflow-y-auto sm:w-56">
                  {groups.includes("times") ? cardList("times", timesOptions, times, layout, setTimes, t("starter.times")) : null}
                  {groups.includes("stays") ? cardList("stays", staysOptions, stays, stayLayout, setStays, t("starter.stays")) : null}
                </div>
                <div className="min-h-64 min-w-0 flex-1">
                  <LayoutPreview group={activeGroup} times={times} stays={stays} ctx={ctx} channel={channel} previewIntl={previewIntl} />
                </div>
              </div>
            </div>
            <DialogFooterBar className="sm:justify-end">
              <div className="flex items-center gap-2">
                {starter ? leaveButton : null}
                <Button variant="brand" size="sm" onClick={choose}>
                  {starter ? t("starter.continue") : t("starter.picker.use")}
                </Button>
              </div>
            </DialogFooterBar>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
