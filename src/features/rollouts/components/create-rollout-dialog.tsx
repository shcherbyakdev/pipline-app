"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createRollout, type CreateRolloutState } from "@/features/rollouts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type TemplateOption = { id: string; name: string; stageCount: number };

const initial: CreateRolloutState = {};

export function CreateRolloutDialog({ templates }: { templates: TemplateOption[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlOpen = searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [state, action, pending] = useActionState(createRollout, initial);

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/rollouts");
  };

  const usable = templates.filter((t) => t.stageCount > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New rollout
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New rollout</DialogTitle>
        </DialogHeader>
        {templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Rollouts are created from a template, and you don&apos;t have any yet.{" "}
            <Link href="/templates?new=1" className="text-foreground underline">
              Create a template first
            </Link>
            .
          </p>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rollout-template">Template</Label>
              <select
                id="rollout-template"
                name="templateId"
                required
                defaultValue={usable[0]?.id ?? ""}
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.stageCount === 0}>
                    {t.name}
                    {t.stageCount === 0 ? " (no stages yet)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rollout-name">Name</Label>
              <Input id="rollout-name" name="name" required maxLength={80} autoFocus />
            </div>
            {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
            <Button type="submit" disabled={pending || usable.length === 0}>
              {pending ? "Creating…" : "Create rollout"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
