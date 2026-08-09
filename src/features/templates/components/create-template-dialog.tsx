"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
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

export function CreateTemplateDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [state, action, pending] = useActionState(createTemplate, initial);
  const router = useRouter();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Drop a stale ?new=1 so refresh/back doesn't reopen the dialog.
    if (!next) router.replace("/templates");
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
