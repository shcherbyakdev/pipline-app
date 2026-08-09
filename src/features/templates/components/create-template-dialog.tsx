"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { createTemplate, type CreateTemplateState } from "@/features/templates/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" name="name" required maxLength={80} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea id="template-description" name="description" maxLength={500} rows={3} />
          </div>
          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create template"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
