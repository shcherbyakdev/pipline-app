"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createOffering, updateOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import type { RangeMode } from "@/features/rentals/range";
import type { DepositType } from "@/features/rentals/pricing";
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
import { SPACES } from "@/features/orgs/vocab";

// create-booking-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

const INCREMENT_OPTIONS = [15, 30, 60];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

export function OfferingDialog({
  offering,
  currency,
}: {
  offering?: OfferingRow;
  currency: string;
}) {
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
  // Controlled so the render branch (Stay section fields) and the payload
  // built in onSubmit always agree on which fields are on the page —
  // switching modes mid-form unmounts the other branch's inputs, so a
  // stale field is never in the submitted FormData.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>(offering?.rangeMode ?? "nights");
  // Drives the min/max duration inputs' `step` so it tracks the increment
  // select live, not just at mount.
  const [slotIncrementMin, setSlotIncrementMin] = React.useState<number>(
    offering?.slotIncrementMin ?? 30,
  );
  // Controlled so the deposit-value input's semantics (amount vs. percent)
  // and its very presence (none/full take no value) track the select live.
  const [depositType, setDepositType] = React.useState<DepositType>(
    offering?.depositType ?? "none",
  );

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
    const price = String(fd.get("price") ?? "").trim();
    const termsText = String(fd.get("termsText") ?? "").trim();
    const depositValueRaw = String(fd.get("depositValue") ?? "").trim();
    const depositValue =
      depositType === "fixed" || depositType === "percent"
        ? depositValueRaw === ""
          ? null
          : depositType === "fixed"
            ? Math.round(Number(depositValueRaw) * 100)
            : Math.round(Number(depositValueRaw))
        : null;
    const cancelWindowRaw = String(fd.get("cancelWindow") ?? "").trim();
    const cancelWindowMin =
      cancelWindowRaw === ""
        ? 0
        : Math.round(Number(cancelWindowRaw) * (rangeMode === "hours" ? 60 : 1440));
    const common = {
      name,
      description: description === "" ? undefined : description,
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      unitSelection: String(fd.get("unitSelection") ?? "auto"),
      active: fd.get("active") === "on",
      priceCents: price === "" ? null : Math.round(Number(price) * 100),
      pricingMode: String(fd.get("pricingMode") ?? "per_unit"),
      depositType,
      depositValue,
      cancelWindowMin,
      termsText: termsText === "" ? undefined : termsText,
    };
    // The hours Zod branch is `.strict()` — only that mode's own fields go
    // in, or parsing fails (schema.ts).
    const payload =
      rangeMode === "hours"
        ? {
            ...common,
            rangeMode: "hours" as const,
            slotIncrementMin: Number(fd.get("slotIncrementMin")),
            minDurationMin: Number(fd.get("minDurationMin")),
            maxDurationMin: Number(fd.get("maxDurationMin")),
            turnoverMin: Number(fd.get("turnoverMin")),
            minNoticeMin: Number(fd.get("minNoticeMin")),
          }
        : {
            ...common,
            rangeMode,
            startTime: String(fd.get("startTime") ?? ""),
            endTime: String(fd.get("endTime") ?? ""),
            minStay: Number(fd.get("minStay")),
            maxStay:
              String(fd.get("maxStay") ?? "").trim() === ""
                ? null
                : Number(fd.get("maxStay")),
            turnoverDays: Number(fd.get("turnoverDays")),
            minNoticeDays: Number(fd.get("minNoticeDays")),
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
              <Plus className="size-4" /> {SPACES.newButton}
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? SPACES.dialogTitle.edit : SPACES.dialogTitle.new}</DialogTitle>
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
          <SectionHeading>Pricing & policies</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-price">Price ({currency})</Label>
              <Input
                id="offering-price"
                name="price"
                type="number"
                min={0}
                step="0.01"
                placeholder="Unpriced"
                defaultValue={offering?.priceCents != null ? offering.priceCents / 100 : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-pricing-mode">Pricing mode</Label>
              <select
                id="offering-pricing-mode"
                name="pricingMode"
                className={selectClass}
                defaultValue={offering?.pricingMode ?? "per_unit"}
              >
                <option value="per_unit">
                  {rangeMode === "hours" ? "Per hour" : rangeMode === "nights" ? "Per night" : "Per day"}
                </option>
                <option value="flat">Flat per booking</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-deposit-type">Deposit</Label>
              <select
                id="offering-deposit-type"
                name="depositType"
                className={selectClass}
                value={depositType}
                onChange={(e) => setDepositType(e.target.value as DepositType)}
              >
                <option value="none">No deposit</option>
                <option value="fixed">Fixed amount</option>
                <option value="percent">Percent of total</option>
                <option value="full">Full amount</option>
              </select>
            </div>
            {depositType === "fixed" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-deposit-value">Deposit amount ({currency})</Label>
                <Input
                  id="offering-deposit-value"
                  name="depositValue"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={
                    offering?.depositType === "fixed" && offering.depositValue != null
                      ? offering.depositValue / 100
                      : ""
                  }
                />
              </div>
            ) : depositType === "percent" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-deposit-value">Deposit (%)</Label>
                <Input
                  id="offering-deposit-value"
                  name="depositValue"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={
                    offering?.depositType === "percent" && offering.depositValue != null
                      ? offering.depositValue
                      : ""
                  }
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-cancel-window">
              Free cancellation until ({rangeMode === "hours" ? "hours" : "days"} before start)
            </Label>
            <Input
              id="offering-cancel-window"
              name="cancelWindow"
              type="number"
              min={0}
              placeholder="No window"
              defaultValue={
                offering && offering.cancelWindowMin > 0
                  ? offering.rangeMode === "hours"
                    ? offering.cancelWindowMin / 60
                    : offering.cancelWindowMin / 1440
                  : ""
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-terms">Terms</Label>
            <Textarea
              id="offering-terms"
              name="termsText"
              rows={4}
              maxLength={10000}
              defaultValue={offering?.termsText ?? ""}
            />
          </div>
          {/* "Stay" is a hotel word; an hourly room is a session. `rangeMode`
              is the dialog's own live state (the select just below). */}
          <SectionHeading>{rangeMode === "hours" ? "Session" : "Stay"}</SectionHeading>
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-range-mode">Booked by</Label>
            <select
              id="offering-range-mode"
              name="rangeMode"
              className={selectClass}
              value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value as RangeMode)}
            >
              <option value="nights">Nightly (check-in → check-out)</option>
              <option value="days">Daily (pickup → return)</option>
              <option value="hours">Hourly (booked by the hour)</option>
            </select>
          </div>
          {rangeMode === "hours" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-slot-increment">Slot increment</Label>
                <select
                  id="offering-slot-increment"
                  name="slotIncrementMin"
                  className={selectClass}
                  value={slotIncrementMin}
                  onChange={(e) => setSlotIncrementMin(Number(e.target.value))}
                >
                  {/* Guards an existing offering whose increment isn't one of
                      the three common values — editing must not silently
                      snap it to 15. */}
                  {!INCREMENT_OPTIONS.includes(slotIncrementMin) ? (
                    <option value={slotIncrementMin}>{slotIncrementMin} min</option>
                  ) : null}
                  {INCREMENT_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-min-duration">Min duration (min)</Label>
                  {/* No `min` here: the HTML step-validation base is `min`
                      (falling back to 0 when absent), so `min={5}` +
                      `step={slotIncrementMin}` would only accept
                      5, 5+step, 5+2·step… — disjoint from the Zod branch's
                      multiples-of-increment-from-0 grid, so no real value
                      (e.g. 60/240 with a 15/30/60 increment) could ever pass
                      native validation. The 5-minute floor is still
                      enforced server-side by hoursFields's `.min(5)`. */}
                  <Input
                    id="offering-min-duration"
                    name="minDurationMin"
                    type="number"
                    required
                    max={1440}
                    step={slotIncrementMin}
                    defaultValue={offering?.minDurationMin ?? 60}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-max-duration">Max duration (min)</Label>
                  <Input
                    id="offering-max-duration"
                    name="maxDurationMin"
                    type="number"
                    required
                    max={1440}
                    step={slotIncrementMin}
                    defaultValue={offering?.maxDurationMin ?? 240}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-turnover-min">Turnover (minutes)</Label>
                  <Input
                    id="offering-turnover-min"
                    name="turnoverMin"
                    type="number"
                    min={0}
                    max={1440}
                    defaultValue={offering?.turnoverMin ?? 0}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-start-time">Start time</Label>
                  <Input
                    id="offering-start-time"
                    name="startTime"
                    type="time"
                    step={900}
                    required
                    defaultValue={offering?.startTime ?? "15:00"}
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
                    defaultValue={offering?.endTime ?? "11:00"}
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
            </>
          )}

          <SectionHeading>Booking</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            {rangeMode === "hours" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-min-notice-min">Min notice (minutes)</Label>
                <Input
                  id="offering-min-notice-min"
                  name="minNoticeMin"
                  type="number"
                  min={0}
                  max={43200}
                  defaultValue={offering?.minNoticeMin ?? 0}
                />
              </div>
            ) : (
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
            )}
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
