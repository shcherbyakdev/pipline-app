"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { applyType, templateOf, typePreview, typesFor, type BusinessType } from "../business-types";
import { STARTER } from "../copy";
import { initialStarterState, starterReducer, type StarterAction, type StarterState } from "./starter-state";
import { ConfirmDialog } from "./confirm-dialog";
import { FirstServiceForm, FirstSpaceForm } from "./first-item-form";

/* Live thumbnails: the real PageRenderer, scaled, with the org's own
   name/logo/services and the template's sample copy. `inert` keeps the
   widget inside from taking focus or clicks. The skin layers over the org's
   theme exactly as applySkin does — colour overrides included — so the
   thumbnail is what you'd actually get. A thumbnail is a template, not a
   page: no cross-link. */
function TypeThumb({ type, ctx, mode }: { type: BusinessType; ctx: RenderContext; mode: OrgMode }) {
  const template = templateOf(type);
  const base: WidgetThemeConfig = template.skin ? { ...ctx.theme, ...template.skin } : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-md border" aria-hidden inert>
      <div className={cn("pointer-events-none absolute top-0 left-0 w-[900px] origin-top-left scale-[0.3] p-8", scheme, "bg-background text-foreground")}>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            <PageRenderer doc={typePreview(type, mode)} ctx={{ ...ctx, theme, mode: "preview", crossLink: null }} />
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
  variant, channel, doc, ctx, mode, needsFirstItem, applyLookDefault, currency, onApply, finalFocus,
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
  const [state, setState] = React.useState<StarterState>(() => initialStarterState({ applyLook: applyLookDefault }));
  // Picker only: the type chosen while the draft still needs confirming.
  const [pending, setPending] = React.useState<BusinessType | null>(null);
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const reset = () => setState(initialStarterState({ applyLook: applyLookDefault }));

  const finish = (next: StarterState) => {
    if (!next.type) return;
    const template = templateOf(next.type);
    onApply(applyType(next.type, mode), next.applyLook && template.skin ? template.skin : null);
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
  const onOpenChange = (next: boolean) => {
    if (starter && !next) return;
    setOpen(next);
    if (!next) reset();
  };

  const types = typesFor(channel);
  const title = starter ? STARTER.title : STARTER.picker.title;
  const sub = starter ? STARTER.sub : STARTER.picker.sub;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {starter ? null : <DialogTrigger render={<Button variant="outline" size="sm">{STARTER.picker.trigger}</Button>} />}
        <DialogContent className="sm:max-w-3xl" showCloseButton={!starter} finalFocus={finalFocus}>
          {state.step === "firstItem" && state.type ? (
            <>
              <DialogHeader>
                <DialogTitle>{channel === "appointments" ? STARTER.firstService.title : STARTER.firstSpace.title}</DialogTitle>
                <DialogDescription>{channel === "appointments" ? STARTER.firstService.sub : STARTER.firstSpace.sub}</DialogDescription>
              </DialogHeader>
              {!starter ? (
                <p className="text-muted-foreground text-sm">{channel === "appointments" ? STARTER.firstService.why : STARTER.firstSpace.why}</p>
              ) : null}
              {channel === "appointments" ? (
                <FirstServiceForm currency={currency} onCreated={onCreated} onBack={() => dispatch({ kind: "back" })} />
              ) : (
                <FirstSpaceForm currency={currency} onCreated={onCreated} onBack={() => dispatch({ kind: "back" })} />
              )}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{sub}</DialogDescription>
              </DialogHeader>
              {/* Off unless the org-wide look is unclaimed (skinDefault): unlike
                  the sections, the look saves straight to the live page and embed. */}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={state.applyLook} onCheckedChange={(c) => dispatch({ kind: "toggleLook", value: c })} />
                <span>
                  {STARTER.look}
                  <span className="text-muted-foreground block text-xs">{STARTER.lookHint}</span>
                </span>
              </label>
              <ul className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
                {types.map((t) => (
                  <li key={t.id}>
                    {/* Click anywhere on the card selects; the name/examples is a
                        real <button>, so Enter/Space come for free and bubble to the
                        wrapper as a click. The thumbnail stays an inert sibling — never
                        a descendant of an interactive role. */}
                    <div
                      onClick={() => choose(t)}
                      className="hover:border-primary has-[button:focus-visible]:ring-ring/50 flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2 has-[button:focus-visible]:ring-2"
                    >
                      <TypeThumb type={t} ctx={ctx} mode={mode} />
                      <button type="button" className="flex flex-col items-start gap-0.5 text-left outline-none" aria-label={`${t.name} — ${t.examples}`}>
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="text-muted-foreground text-xs">{t.examples}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {starter ? (
            // Ruling 2's exit, reachable from inside the focus trap: leave the page, never the step.
            <div className="flex justify-start">
              <Button variant="ghost" size="sm" onClick={() => router.push("/bookings")}>{STARTER.leave}</Button>
            </div>
          ) : null}
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
