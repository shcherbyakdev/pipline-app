"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WidgetTheme } from "@/components/widget-theme";
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
   widget inside from taking focus or clicks. */
function TemplateThumb({ template, ctx }: { template: Template; ctx: RenderContext }) {
  const base: WidgetThemeConfig = template.skin ? { ...ctx.theme, ...template.skin, background: undefined, text: undefined } : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-md border" aria-hidden inert>
      <div className={cn("pointer-events-none absolute top-0 left-0 w-[900px] origin-top-left scale-[0.3] p-8", scheme, "bg-background text-foreground")}>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            <PageRenderer doc={templatePreview(template)} ctx={{ ...ctx, theme, mode: "preview" }} />
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

export function TemplatePicker({
  doc, ctx, onApply,
}: {
  doc: PageDocument; ctx: RenderContext;
  onApply: (next: PageDocument, skin: TemplateSkin | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [applySkin, setApplySkin] = React.useState(true);
  const [pending, setPending] = React.useState<Template | null>(null);
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const commit = (t: Template) => {
    onApply(applyTemplate(t), applySkin && t.skin ? t.skin : null);
    setPending(null);
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm">Start from a template</Button>} />
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
            <DialogDescription>Pick a starting point, then make it yours. Your published page stays until you publish.</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={applySkin} onCheckedChange={(c) => setApplySkin(c === true)} />
            Also apply the template&apos;s look (theme, font, corners)
          </label>
          <ul className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                {/* A <button> can't contain the thumbnail's own SectionFrame
                    "Edit …" buttons (invalid nested-interactive HTML — the
                    thumbnail is `inert` regardless, so no functionality is
                    lost); role="button" + a key handler keep it a keyboard-
                    operable control. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => (dirty ? setPending(t) : commit(t))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (dirty) setPending(t); else commit(t);
                  }}
                  className="hover:border-primary focus-visible:ring-ring/50 flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left outline-none focus-visible:ring-2"
                >
                  <TemplateThumb template={t} ctx={ctx} />
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-muted-foreground text-xs">{t.description}</span>
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
