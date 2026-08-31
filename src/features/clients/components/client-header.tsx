"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { renameClient, deleteClient } from "@/features/clients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ClientHeader({ id, name }: { id: string; name: string }) {
  const [value, setValue] = React.useState(name);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const commitRename = () => {
    const next = value.trim();
    if (next === "" || next === name) {
      setValue(name);
      return;
    }
    startTransition(async () => {
      const result = await renameClient({ id, name: next });
      if (!result.ok) {
        setValue(name);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label="Client name"
        className="border-transparent text-lg font-semibold shadow-none focus-visible:border-input"
      />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* Labeled, not icon-only: destructive intent should be readable
            before the pointer commits (the dialog still confirms). */}
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0">
              <Trash2 className="size-4" /> Delete client
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this client?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Bookings keep their history (name and email stay on each booking);
            the client entry itself is deleted.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteClient({ id });
                  // On success the action redirects; only failures return.
                  if (result && !result.ok) toast.error(result.error);
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
