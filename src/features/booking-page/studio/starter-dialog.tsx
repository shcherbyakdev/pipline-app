"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { OrgMode } from "@/features/orgs/mode";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { cn } from "@/lib/utils";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";
import type { PageChannel } from "../channel";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import type { TemplateSkin } from "../templates";
import {
  applyType,
  templateOf,
  typePreview,
  typesFor,
  type BusinessType,
} from "../business-types";
import { STARTER } from "../copy";
import {
  initialStarterState,
  starterReducer,
  type StarterAction,
  type StarterState,
} from "./starter-state";
import { ConfirmDialog } from "./confirm-dialog";
import { FirstServiceForm, FirstSpaceForm } from "./first-item-form";

/* Full-size live preview (the Notion-template-gallery pattern): the real
   PageRenderer with the org's own name/logo/services and the template's
   sample copy, so what you see IS the page you get. `inert` keeps the
   widget inside from taking focus or clicks. The skin layers over the org's
   theme exactly as applySkin does — colour overrides included. CSS `zoom`
   (not transform scale) so the shrunk page keeps a real layout height and
   the pane scrolls naturally. A preview is a template, not a page: no
   cross-link. */
function TypePreview({
  type,
  ctx,
  mode,
}: {
  type: BusinessType;
  ctx: RenderContext;
  mode: OrgMode;
}) {
  const template = templateOf(type);
  const base: WidgetThemeConfig = template.skin
    ? { ...ctx.theme, ...template.skin }
    : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div
      className="bg-muted/50 relative h-full overflow-x-hidden overflow-y-auto rounded-xl border"
      aria-hidden
      inert
    >
      <div
        className={cn(
          "pointer-events-none w-[900px] p-8",
          scheme,
          "bg-background text-foreground",
        )}
        style={{ zoom: 0.68 }}
      >
        <WidgetTheme
          config={theme}
          accentColor={ctx.branding.accentColor}
          transparent
        >
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            <PageRenderer
              doc={typePreview(type, mode)}
              ctx={{ ...ctx, theme, mode: "preview", crossLink: null }}
            />
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

/* The starter (spec 2026-08-28 §5) and, in `picker` mode, the "Start from a
   template" dialog it replaces — one component, one reducer
   (starter-state.ts). Starter: opens itself on a fresh page and cannot be
   dismissed (Base UI 1.7 has no `dismissible`, so `open` is controlled and
   every `onOpenChange(false)` is ignored; a Leave link returns to Bookings —
   ruling 2's exit, reachable inside the focus trap). Picker: a trigger
   button, dismissable, and the old "replace your draft?" confirm when the
   draft is not the default. */
export function StarterDialog({
  variant,
  channel,
  doc,
  ctx,
  mode,
  needsFirstItem,
  applyLookDefault,
  currency,
  onApply,
  finalFocus,
}: {
  variant: "starter" | "picker";
  channel: PageChannel;
  doc: PageDocument;
  ctx: RenderContext;
  mode: OrgMode;
  needsFirstItem: boolean;
  applyLookDefault: boolean;
  currency: string;
  onApply: (next: PageDocument, skin: TemplateSkin | null) => void;
  finalFocus?: React.RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const starter = variant === "starter";
  const [open, setOpen] = React.useState(starter);
  const [state, setState] = React.useState<StarterState>(() =>
    initialStarterState({ applyLook: applyLookDefault }),
  );
  // Picker only: the type chosen while the draft still needs confirming.
  const [pending, setPending] = React.useState<BusinessType | null>(null);
  // Which template the big preview pane shows — view state only; nothing is
  // applied until "Use this template" / Continue.
  const [previewType, setPreviewType] = React.useState<BusinessType>(
    () => typesFor(channel)[0],
  );
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const reset = () =>
    setState(initialStarterState({ applyLook: applyLookDefault }));

  const finish = (next: StarterState) => {
    if (!next.type) return;
    const template = templateOf(next.type);
    onApply(
      applyType(next.type, mode),
      next.applyLook && template.skin ? template.skin : null,
    );
    reset();
    setOpen(false);
  };
  const dispatch = (action: StarterAction) => {
    const next = starterReducer(state, action);
    setState(next);
    if (next.step === "done") finish(next);
  };
  const choose = (t: BusinessType) => {
    if (!starter && dirty) setPending(t);
    else dispatch({ kind: "choose", type: t, needsFirstItem });
  };
  const onCreated = () => {
    // Close first — the route re-renders with the real service/space in the
    // preview catalogue, and the draft hook is seeded once, so refreshing
    // never resets the draft. Dispatching first keeps the close off the
    // server round trip.
    dispatch({ kind: "created" });
    router.refresh();
  };
  const onOpenChange: NonNullable<
    React.ComponentProps<typeof Dialog>["onOpenChange"]
  > = (next, details) => {
    if (starter && !next) {
      // The X is ruling 2's Leave exit; Esc/backdrop stay swallowed so an
      // accidental dismissal mid-flow never navigates away.
      if (details.reason === "close-press") router.push("/bookings");
      return;
    }
    setOpen(next);
    if (!next) reset();
  };

  const types = typesFor(channel);
  const title = starter ? STARTER.title : STARTER.picker.title;
  const sub = starter ? STARTER.sub : STARTER.picker.sub;
  const atFirstItem = state.step === "firstItem" && state.type !== null;
  // Ruling 2's exit, reachable from inside the focus trap: leave the page,
  // never the step.
  const leaveButton = (
    <Button variant="ghost" size="sm" onClick={() => router.push("/bookings")}>
      {STARTER.leave}
    </Button>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {starter ? null : (
          <DialogTrigger
            render={
              <Button variant="outline" size="sm">
                {STARTER.picker.trigger}
              </Button>
            }
          />
        )}
        <DialogContent
          className={cn(dialogPanelClass, "sm:max-w-4xl")}
          finalFocus={finalFocus}
        >
          <DialogBreadcrumbHeader chip={<DialogChip>Booking page</DialogChip>}>
            {atFirstItem
              ? channel === "appointments"
                ? STARTER.firstService.title
                : STARTER.firstSpace.title
              : title}
          </DialogBreadcrumbHeader>
          {atFirstItem ? (
            <>
              <div className="flex flex-col px-5 pt-2 pb-6">
                <DialogDescription>
                  {channel === "appointments"
                    ? STARTER.firstService.sub
                    : STARTER.firstSpace.sub}
                </DialogDescription>
                {!starter ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {channel === "appointments"
                      ? STARTER.firstService.why
                      : STARTER.firstSpace.why}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-col">
                  {channel === "appointments" ? (
                    <FirstServiceForm
                      currency={currency}
                      onCreated={onCreated}
                      onBack={() => dispatch({ kind: "back" })}
                    />
                  ) : (
                    <FirstSpaceForm
                      currency={currency}
                      onCreated={onCreated}
                      onBack={() => dispatch({ kind: "back" })}
                    />
                  )}
                </div>
              </div>
              {starter ? (
                <DialogFooterBar className="sm:justify-start">
                  {leaveButton}
                </DialogFooterBar>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex flex-col px-5 pt-2 pb-5">
                <DialogDescription>{sub}</DialogDescription>
                {/* The Notion-gallery split: pick on the left, see the whole
                    page — with the org's own name and services — on the
                    right. Nothing applies until the footer CTA. */}
                <div className="mt-4 flex flex-col gap-3 sm:h-[58vh] sm:flex-row">
                  <div
                    className="flex shrink-0 flex-col gap-1 overflow-y-auto sm:w-52"
                    role="listbox"
                    aria-label={title}
                  >
                    {types.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={t.id === previewType.id}
                        onClick={() => setPreviewType(t)}
                        className={cn(
                          "focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2",
                          t.id === previewType.id
                            ? "bg-secondary"
                            : "hover:bg-muted",
                        )}
                      >
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {t.examples}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-64 min-w-0 flex-1">
                    <TypePreview type={previewType} ctx={ctx} mode={mode} />
                  </div>
                </div>
              </div>
              <DialogFooterBar className="items-start sm:justify-between">
                {/* The look option rides the action it modifies (the Linear
                    footer-toggle spot). Off unless the org-wide look is
                    unclaimed (skinDefault): unlike the sections, the look
                    saves straight to the live page and embed. */}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={state.applyLook}
                    onCheckedChange={(c) =>
                      dispatch({ kind: "toggleLook", value: c })
                    }
                  />
                  <span>
                    {STARTER.look}
                    <span className="text-muted-foreground block text-xs">
                      {STARTER.lookHint}
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  {starter ? leaveButton : null}
                  <Button
                    variant="brand"
                    size="sm"
                    onClick={() => choose(previewType)}
                  >
                    {starter ? STARTER.continue : STARTER.picker.use}
                  </Button>
                </div>
              </DialogFooterBar>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        title={STARTER.replace.title}
        description={STARTER.replace.description}
        confirmLabel={STARTER.replace.confirm}
        onConfirm={() => {
          const t = pending;
          setPending(null);
          if (t) dispatch({ kind: "choose", type: t, needsFirstItem });
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}
