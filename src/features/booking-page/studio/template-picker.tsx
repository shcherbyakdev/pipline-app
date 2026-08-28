"use client";

import * as React from "react";
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
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { TEMPLATES, applyTemplate, templatePreview, type Template, type TemplateSkin } from "../templates";
import { ConfirmDialog } from "./confirm-dialog";

/* Live thumbnails: the real PageRenderer, scaled, with the org's own
   name/logo/services and the template's sample copy. `inert` keeps the
   widget inside from taking focus or clicks. The skin layers over the org's
   theme exactly as applySkin does — colour overrides included — so the
   thumbnail is what you'd actually get. */
function TemplateThumb({ template, ctx, mode }: { template: Template; ctx: RenderContext; mode: OrgMode }) {
  const base: WidgetThemeConfig = template.skin ? { ...ctx.theme, ...template.skin } : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-md border" aria-hidden inert>
      <div className={cn("pointer-events-none absolute top-0 left-0 w-[900px] origin-top-left scale-[0.3] p-8", scheme, "bg-background text-foreground")}>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            {/* A thumbnail is a template, not a page — it never carries the sibling-channel link. */}
            <PageRenderer doc={templatePreview(template, mode)} ctx={{ ...ctx, theme, mode: "preview", crossLink: null }} />
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

export function TemplatePicker({
  doc, ctx, mode, onApply,
}: {
  doc: PageDocument; ctx: RenderContext; mode: OrgMode;
  onApply: (next: PageDocument, skin: TemplateSkin | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Off by default: unlike the sections (a draft until published), the look
  // is org-wide branding that saves straight to the live page and embed.
  const [applySkin, setApplySkin] = React.useState(false);
  const [pending, setPending] = React.useState<Template | null>(null);
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const commit = (t: Template) => {
    onApply(applyTemplate(t, mode), applySkin && t.skin ? t.skin : null);
    setPending(null);
    setOpen(false);
  };
  const choose = (t: Template) => (dirty ? setPending(t) : commit(t));

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm">Start from a template</Button>} />
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
            <DialogDescription>Pick a starting point, then make it yours. Your published page stays until you publish.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={applySkin} onCheckedChange={(c) => setApplySkin(c === true)} />
            <span>
              Also apply the template&apos;s look now (theme, font, corners)
              <span className="text-muted-foreground block text-xs">
                Unlike the sections, this changes the live page and website embed immediately.
              </span>
            </span>
          </label>
          <ul className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {TEMPLATES.filter((t) => t.id !== "venue" || mode.offersRentals).map((t) => (
              <li key={t.id}>
                {/* Click anywhere on the card selects; the name/description is a
                    real <button>, so Enter/Space come for free and bubble to the
                    wrapper as a click. The thumbnail stays an inert sibling — never
                    a descendant of an interactive role (Tasks 7–8 ruling). */}
                <div
                  onClick={() => choose(t)}
                  className="hover:border-primary has-[button:focus-visible]:ring-ring/50 flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2 has-[button:focus-visible]:ring-2"
                >
                  <TemplateThumb template={t} ctx={ctx} mode={mode} />
                  <button type="button" className="flex flex-col items-start gap-0.5 text-left outline-none" aria-label={`Use the ${t.name} template`}>
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className="text-muted-foreground text-xs">{t.description}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        title="Replace your current draft?"
        description="Your published page stays until you publish."
        confirmLabel="Replace"
        onConfirm={() => pending && commit(pending)}
        onClose={() => setPending(null)}
      />
    </>
  );
}
