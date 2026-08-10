"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/features/clients/actions";
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

export function CreateClientDialog() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlOpen = searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/clients");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    if (typeof name !== "string" || name.trim() === "") return;
    startTransition(async () => {
      const result = await createClient({ name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.push(`/clients/${result.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New client
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" name="name" required maxLength={120} autoFocus />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create client"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
