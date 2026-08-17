"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createOffering, updateOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { hhmm } from "@/features/rentals/format";
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

// create-booking-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

export function OfferingDialog({ offering }: { offering?: OfferingRow }) {
  const isEdit = Boolean(offering);
  const searchParams = useSearchParams();
  const router = useRouter();
  // Only the create trigger (rendered once, at page level) participates in the
  // `?new=1` URL-driven open — mirrors service-dialog.tsx. Edit dialogs are
  // per-row and only ever opened manually.
  const urlOpen = !isEdit && searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/rentals");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const description = String(fd.get("description") ?? "").trim();
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const maxStayRaw = String(fd.get("maxStay") ?? "").trim();
    const payload = {
      name,
      description: description === "" ? undefined : description,
      priceLabel: priceLabel === "" ? undefined : priceLabel,
      rangeMode: String(fd.get("rangeMode") ?? "nights"),
      startTime: String(fd.get("startTime") ?? ""),
      endTime: String(fd.get("endTime") ?? ""),
      minStay: Number(fd.get("minStay")),
      maxStay: maxStayRaw === "" ? null : Number(maxStayRaw),
      turnoverDays: Number(fd.get("turnoverDays")),
      minNoticeDays: Number(fd.get("minNoticeDays")),
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      unitSelection: String(fd.get("unitSelection") ?? "auto"),
      active: fd.get("active") === "on",
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateOffering({ id: offering!.id, ...payload })
        : await createOffering(payload);
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
              <Plus className="size-4" /> New rental
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit rental" : "New rental"}</DialogTitle>
        </DialogHeader>
        {/* More fields than the service dialog, so the body scrolls rather
            than pushing the popup past the viewport. */}
        <form onSubmit={onSubmit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-1">
          <SectionHeading>Basics</SectionHeading>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-name">Name</Label>
            <Input
              id="offering-name"
              name="name"
              required
              maxLength={200}
              defaultValue={offering?.name}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-description">Description</Label>
            <Textarea
              id="offering-description"
              name="description"
              maxLength={2000}
              defaultValue={offering?.description ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-price-label">Price label</Label>
            <Input
              id="offering-price-label"
              name="priceLabel"
              maxLength={100}
              placeholder="e.g. €120 / night"
              defaultValue={offering?.priceLabel ?? ""}
            />
          </div>

          <SectionHeading>Stay</SectionHeading>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-range-mode">Booked by</Label>
            <select
              id="offering-range-mode"
              name="rangeMode"
              className={selectClass}
              defaultValue={offering?.rangeMode ?? "nights"}
            >
              <option value="nights">Nightly (check-in → check-out)</option>
              <option value="days">Daily (pickup → return)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-start-time">Start time</Label>
              <Input
                id="offering-start-time"
                name="startTime"
                type="time"
                step={900}
                required
                defaultValue={offering ? hhmm(offering.startTime) : "15:00"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-end-time">End time</Label>
              <Input
                id="offering-end-time"
                name="endTime"
                type="time"
                step={900}
                required
                defaultValue={offering ? hhmm(offering.endTime) : "11:00"}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-min-stay">Min stay</Label>
              <Input
                id="offering-min-stay"
                name="minStay"
                type="number"
                required
                min={1}
                max={365}
                defaultValue={offering?.minStay ?? 1}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-max-stay">Max stay</Label>
              <Input
                id="offering-max-stay"
                name="maxStay"
                type="number"
                min={1}
                max={365}
                placeholder="Unlimited"
                defaultValue={offering?.maxStay ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-turnover">Turnover (days)</Label>
              <Input
                id="offering-turnover"
                name="turnoverDays"
                type="number"
                min={0}
                max={30}
                defaultValue={offering?.turnoverDays ?? 0}
              />
            </div>
          </div>

          <SectionHeading>Booking</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-min-notice">Min notice (days)</Label>
              <Input
                id="offering-min-notice"
                name="minNoticeDays"
                type="number"
                min={0}
                max={365}
                defaultValue={offering?.minNoticeDays ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-booking-window">Booking window (days)</Label>
              <Input
                id="offering-booking-window"
                name="bookingWindowDays"
                type="number"
                min={1}
                max={730}
                defaultValue={offering?.bookingWindowDays ?? 180}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-unit-selection">Unit selection</Label>
            <select
              id="offering-unit-selection"
              name="unitSelection"
              className={selectClass}
              defaultValue={offering?.unitSelection ?? "auto"}
            >
              <option value="auto">Assign a unit automatically</option>
              <option value="client_picks">Let the client pick a unit</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="offering-active"
              name="active"
              type="checkbox"
              className="size-4"
              defaultChecked={offering?.active ?? true}
            />
            <Label htmlFor="offering-active">Active</Label>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
