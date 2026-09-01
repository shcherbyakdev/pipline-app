"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-scrim/90 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-(--shadow-card) ring-1 ring-foreground/10 duration-150 ease-strong outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-2xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/* Idioms for Linear-style dialog bodies (the New-booking pattern, Figma ref
   2014:306): a p-0 panel with its own header/body/footer zones, a borderless
   title-zone input, and the small filled property pill that native
   date/time/select inputs wear. */
const dialogPanelClass =
  "flex max-h-[85vh] flex-col gap-0 overflow-y-auto rounded-3xl p-0";
const dialogBareInputClass =
  "placeholder:text-muted-foreground w-full bg-transparent outline-none";
const dialogPillClass =
  "bg-secondary text-foreground focus-visible:border-ring focus-visible:ring-ring/30 h-7 rounded-full border border-transparent px-2.5 text-xs font-medium tabular-nums outline-none focus-visible:ring-3";

const dialogChipTones = {
  // Kind colours only where the chip names a kind of booking (palette rule).
  time: "bg-kind-time-soft text-kind-time-text",
  space: "bg-kind-space-soft text-kind-space-text",
  neutral: "bg-secondary text-secondary-foreground",
} as const;

function DialogChip({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof dialogChipTones }) {
  return (
    <span
      data-slot="dialog-chip"
      className={cn(
        dialogChipTones[tone],
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

/* `chip › title` header row for the p-0 panel; `chip` may be any node (the
   New-booking dialog puts a live <select> pill there). */
function DialogBreadcrumbHeader({
  chip,
  children,
}: {
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DialogHeader className="flex-row items-center gap-2 px-5 pt-5 pr-12">
      {chip}
      {chip ? (
        <span aria-hidden className="text-muted-foreground text-sm">
          ›
        </span>
      ) : null}
      <DialogTitle className="text-sm">{children}</DialogTitle>
    </DialogHeader>
  );
}

/* DialogFooter re-based for the p-0 panel (no parent padding to offset).
   Sticky so a long body (e.g. the space dialog with its rules open) never
   scrolls the only submit control out of view; the color-mix reproduces the
   footer's translucent bg-muted/50-over-popover tint as an opaque colour,
   since content scrolling under a pinned footer would ghost through 50%. */
function DialogFooterBar({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn(
        "sticky bottom-0 mx-0 mb-0 items-center rounded-b-3xl px-5",
        "bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-popover))]",
        className,
      )}
      {...props}
    />
  );
}

export {
  dialogPanelClass,
  dialogBareInputClass,
  dialogPillClass,
  DialogChip,
  DialogBreadcrumbHeader,
  DialogFooterBar,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
