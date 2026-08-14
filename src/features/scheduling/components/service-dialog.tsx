"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createService, updateService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
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

export function ServiceDialog({ service }: { service?: ServiceRow }) {
  const isEdit = Boolean(service);
  const searchParams = useSearchParams();
  const router = useRouter();
  // Only the create trigger (rendered once, at page level) participates in
  // the `?new=1` URL-driven open — Task 14 links to /services?new=1 to open
  // the create dialog directly. Edit dialogs are per-row and only ever
  // opened manually.
  const urlOpen = !isEdit && searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/services");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const description = String(fd.get("description") ?? "").trim();
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const maxPerDayRaw = String(fd.get("maxPerDay") ?? "").trim();
    const payload = {
      name,
      description: description === "" ? undefined : description,
      durationMin: Number(fd.get("durationMin")),
      priceLabel: priceLabel === "" ? undefined : priceLabel,
      bufferBeforeMin: Number(fd.get("bufferBeforeMin")),
      bufferAfterMin: Number(fd.get("bufferAfterMin")),
      minNoticeMin: Number(fd.get("minNoticeMin")),
      maxPerDay: maxPerDayRaw === "" ? null : Number(maxPerDayRaw),
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      active: fd.get("active") === "on",
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateService({ id: service!.id, ...payload })
        : await createService(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      toast.success("Saved");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button size="sm" variant="outline">
              <Pencil className="size-4" /> Edit
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> New service
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              name="name"
              required
              maxLength={200}
              defaultValue={service?.name}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="service-description">Description</Label>
            <Textarea
              id="service-description"
              name="description"
              maxLength={2000}
              defaultValue={service?.description ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-duration">Duration (min)</Label>
              <Input
                id="service-duration"
                name="durationMin"
                type="number"
                required
                min={5}
                max={480}
                defaultValue={service?.durationMin}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-price-label">Price label</Label>
              <Input
                id="service-price-label"
                name="priceLabel"
                maxLength={100}
                placeholder="e.g. €50"
                defaultValue={service?.priceLabel ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-buffer-before">Buffer before (min)</Label>
              <Input
                id="service-buffer-before"
                name="bufferBeforeMin"
                type="number"
                min={0}
                max={240}
                defaultValue={service?.bufferBeforeMin ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-buffer-after">Buffer after (min)</Label>
              <Input
                id="service-buffer-after"
                name="bufferAfterMin"
                type="number"
                min={0}
                max={240}
                defaultValue={service?.bufferAfterMin ?? 0}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-min-notice">Min notice (min)</Label>
              <Input
                id="service-min-notice"
                name="minNoticeMin"
                type="number"
                min={0}
                max={20160}
                defaultValue={service?.minNoticeMin ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-max-per-day">Max per day</Label>
              <Input
                id="service-max-per-day"
                name="maxPerDay"
                type="number"
                min={1}
                max={100}
                placeholder="Unlimited"
                defaultValue={service?.maxPerDay ?? ""}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="service-booking-window">Booking window (days)</Label>
            <Input
              id="service-booking-window"
              name="bookingWindowDays"
              type="number"
              min={1}
              max={365}
              defaultValue={service?.bookingWindowDays ?? 60}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="service-active"
              name="active"
              type="checkbox"
              className="size-4"
              defaultChecked={service?.active ?? true}
            />
            <Label htmlFor="service-active">Active</Label>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
