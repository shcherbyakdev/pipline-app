import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* Compact settings primitives (Linear settings pattern): a card with a
   header, hairline-separated rows, an optional footer for a save action.
   Rows keep label + control tight (no per-field paragraphs); one short
   hint at most, muted, below the control. */
export function SettingsCard({
  title,
  description,
  footer,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card overflow-hidden rounded-lg border", className)}>
      <header className="flex flex-col gap-0.5 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </header>
      <div className="divide-y">{children}</div>
      {footer ? <footer className="bg-secondary/40 flex items-center justify-end gap-2 border-t px-4 py-2.5">{footer}</footer> : null}
    </section>
  );
}

/* `htmlFor` names the row's one control. Without it (a swatch row, an
   upload button, a colour pair) the heading is a plain <p> the row points at
   via role="group" — a <label> tied to nothing is announced as orphaned. */
export function SettingsRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  const hintNode = hint ? <p className="text-muted-foreground text-[11px] leading-4">{hint}</p> : null;
  if (!htmlFor) {
    return (
      <div role="group" aria-labelledby={headingId} className="flex flex-col gap-1.5 px-4 py-3">
        <p id={headingId} className="text-xs leading-none font-medium select-none">
          {label}
        </p>
        {children}
        {hintNode}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hintNode}
    </div>
  );
}
