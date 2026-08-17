"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { validateStay, type RangeAvailability } from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { dateInZone } from "@/features/scheduling/slots";
import {
  getAdminRangeAvailability,
  createRentalBookingAdmin,
} from "@/features/rentals/booking-actions";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { RangePicker, staySummary, type RangeValue } from "./range-picker";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// See move-rental-dialog.tsx: 62 rendered days + the longest turnover tail.
const WINDOW_DAYS = 93;
// create-booking-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

// The prefill props seed state on mount only: the timeline mounts this per
// opening (and unmounts it on close) so each empty cell's offering/unit/date
// lands in the initial state.
export function NewRentalBookingDialog({
  open,
  onOpenChange,
  offerings,
  initialOfferingId,
  initialUnitId,
  initialStartDate,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerings: Array<{ id: string; name: string }>;
  initialOfferingId?: string;
  initialUnitId?: string | null;
  initialStartDate?: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [offeringId, setOfferingId] = React.useState(
    () => initialOfferingId ?? offerings[0]?.id ?? "",
  );
  const [month, setMonth] = React.useState(() =>
    monthOf(initialStartDate ?? dateInZone(new Date(), timeZone)),
  );
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  // A click on an empty cell means "check in here" — the end date is still
  // the provider's to pick.
  const [range, setRange] = React.useState<RangeValue>(() => ({
    start: initialStartDate ?? null,
    end: null,
  }));
  const [unitId, setUnitId] = React.useState<string | null>(initialUnitId ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const load = React.useCallback(
    (id: string, m: string) => {
      if (!id) return;
      startTransition(async () => {
        const result = await getAdminRangeAvailability({
          offeringId: id,
          fromDate: firstOfMonth(m),
          days: WINDOW_DAYS,
          excludeBookingId: null,
        });
        if (result.ok) {
          setAvailability(result.availability);
          setOffering(result.offering);
          setUnits(result.units);
        } else {
          setAvailability(null);
          setError(result.error);
        }
      });
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    load(offeringId, month);
  }, [open, offeringId, month, load]);

  function changeOffering(id: string) {
    setError(null);
    setOfferingId(id);
    setOffering(null);
    setAvailability(null);
    setRange({ start: null, end: null });
    setUnitId(null);
  }
  function changeMonth(m: string) {
    setError(null);
    setMonth(m);
  }
  function changeRange(next: RangeValue) {
    setError(null);
    setUnitId(null);
    setRange(next);
  }

  const stay =
    offering && availability && range.start && range.end
      ? validateStay(offering, availability, range.start, range.end)
      : null;
  const freeUnitIds = stay && stay.ok ? stay.unitIds : null;
  // A prefilled unit that isn't free for the chosen dates must not be sent —
  // the select would show it as unselected while the state still held it.
  const effectiveUnitId = unitId && freeUnitIds?.includes(unitId) ? unitId : null;

  function submit(formData: FormData) {
    const { start, end } = range;
    if (!start || !end) return;
    const email = String(formData.get("email") ?? "").trim();
    startTransition(async () => {
      setError(null);
      const result = await createRentalBookingAdmin({
        offeringId,
        unitId: effectiveUnitId,
        startDate: start,
        endDate: end,
        name: String(formData.get("name") ?? ""),
        email: email || undefined,
        note: String(formData.get("note") ?? "") || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.datesTaken) {
          setRange({ start: null, end: null });
          setUnitId(null);
          load(offeringId, month);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.emailed) toast.success("Booking created — confirmation emailed");
      else if (email)
        toast.warning(
          "Booking created — but the confirmation email failed. Contact the client directly.",
        );
      else toast.success("Booking created (no email on file)");
      onOpenChange(false);
      router.refresh();
    });
  }

  const summary =
    offering && range.start && range.end
      ? staySummary(offering, range.start, range.end, timeZone)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New rental booking</DialogTitle>
          <DialogDescription>
            Recorded on your behalf — notice and booking-window limits don’t apply.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-rental-offering">Offering</Label>
          <select
            id="new-rental-offering"
            className={selectClass}
            value={offeringId}
            onChange={(e) => changeOffering(e.target.value)}
          >
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {offering === null ? (
          <p className="text-muted-foreground text-sm">{error ?? "Loading availability…"}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <RangePicker
              variant="admin"
              offering={offering}
              availability={availability}
              loading={pending}
              month={month}
              onMonthChange={changeMonth}
              value={range}
              onChange={changeRange}
              canGoBack={month > monthOf(dateInZone(new Date(), timeZone))}
              timeZone={timeZone}
            />
            {range.start && range.end ? (
              <form action={submit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-rental-unit">Unit</Label>
                  <UnitSelect
                    id="new-rental-unit"
                    units={units}
                    freeUnitIds={freeUnitIds}
                    value={effectiveUnitId}
                    onChange={setUnitId}
                  />
                </div>
                {summary ? <p className="text-muted-foreground text-sm">{summary}</p> : null}
                <ClientDetailsFields emailOptional idPrefix="new-rental-" />
                <Button type="submit" disabled={pending || !stay?.ok}>
                  {pending ? "Creating…" : "Create booking"}
                </Button>
              </form>
            ) : null}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
