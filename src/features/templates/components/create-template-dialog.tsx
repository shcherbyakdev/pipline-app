"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import {
  createTemplate,
  type CreateTemplateState,
} from "@/features/templates/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogFooterBar,
  DialogTrigger,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const initial: CreateTemplateState = {};

export function CreateTemplateDialog() {
  // Openness is derived from the URL (`?new=1`) rather than seeded once into
  // local state: the palette command navigates via router.push, which — when
  // already on /templates — re-renders this mounted client component instead
  // of remounting it, so a useState(defaultOpen) initializer would never
  // re-run and the dialog would silently fail to open. `manuallyOpened`
  // covers the plain "New template" button, which has no URL to drive it.
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const [state, action, pending] = useActionState(createTemplate, initial);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlOpen = searchParams.get("new") === "1";
  const open = urlOpen || manuallyOpened;

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    // Only drop the query param if it was the thing that opened us — a
    // button-driven open/close should never touch the URL.
    if (!next && urlOpen) router.replace("/templates");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New template
          </Button>
        }
      />
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader chip={<DialogChip>Template</DialogChip>}>
          New template
        </DialogBreadcrumbHeader>
        <form action={action} className="flex flex-col">
          <div className="flex flex-col px-5 pt-4 pb-6">
            <input
              aria-label="Name"
              name="name"
              required
              maxLength={80}
              placeholder="Template name"
              className={cn(dialogBareInputClass, "text-[15px] font-medium")}
              autoFocus
            />
            <textarea
              aria-label="Description (optional)"
              name="description"
              maxLength={500}
              rows={3}
              placeholder="Add a description…"
              className={cn(dialogBareInputClass, "mt-3 resize-none text-sm")}
            />
            {state.error ? (
              <p className="text-destructive mt-3 text-sm">{state.error}</p>
            ) : null}
          </div>
          <DialogFooterBar>
            <Button type="submit" size="sm" variant="brand" disabled={pending}>
              {pending ? "Creating…" : "Create template"}
            </Button>
          </DialogFooterBar>
        </form>
      </DialogContent>
    </Dialog>
  );
}
