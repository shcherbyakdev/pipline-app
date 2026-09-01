"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* The repo had no confirm step anywhere; the builder needs one for Discard,
   "publish with empty sections" and "replace draft with a template". */
export function ConfirmDialog({
  open, title, description, confirmLabel, destructive = false, onConfirm, onClose,
}: {
  open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
