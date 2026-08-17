"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { validateStay, type RangeAvailability } from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { dateInZone } from "@/features/scheduling/slots";
import {
  getManageRangeAvailability,
  rescheduleRentalBooking,
} from "@/features/rentals/manage-actions";
import { RangePicker, type RangeValue } from "./range-picker";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Two rendered months are at most 62 days; the turnover tail (≤ 30) has to
// come along or validateStay reads a missing day at the far edge as
// "unavailable". 62 + 30 fits the action's own 93-day cap, so one constant
// covers every offering and the window never has to be refetched when the
// offering's turnover arrives with the first response (move-rental-dialog).
const WINDOW_DAYS = 93;

// The rental counterpart of ManageBooking's slot grid: a client picking new
// dates for their own stay from the tokenized manage page. Unthemed —
// `variant="admin"` gives the picker the app's palette rather than the
// widget's, which resolves to nothing outside the embed.
export function RentalReschedulePanel({
  token,
  timeZone,
  onCancel,
}: {
  token: string;
  timeZone: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [month, setMonth] = React.useState(() => monthOf(dateInZone(new Date(), timeZone)));
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [currentUnitId, setCurrentUnitId] = React.useState<string | null>(null);
  const [range, setRange] = React.useState<RangeValue>({ start: null, end: null });
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // The stay's own month is the useful starting view, but only the server
  // knows its check-in date; the first response jumps there unless the
  // client has already navigated somewhere themselves.
  const navigated = React.useRef(false);

  // Deliberately does NOT clear `error`: the datesTaken path reloads
  // availability and wants its message to survive the reload.
  const load = React.useCallback(
    (m: string) => {
      startTransition(async () => {
        const result = await getManageRangeAvailability({
          token,
          fromDate: firstOfMonth(m),
          days: WINDOW_DAYS,
        });
        if (result.ok) {
          setAvailability(result.availability);
          setOffering(result.offering);
          setUnits(result.units);
          setCurrentUnitId(result.currentUnitId);
          // Functional update so this does not have to depend on `month`;
          // the effect below refetches when it actually changes.
          setMonth((current) =>
            navigated.current ? current : monthOf(result.startDate),
          );
        } else {
          setAvailability(null);
          setError(result.error);
        }
      });
    },
    [token],
  );

  React.useEffect(() => {
    load(month);
  }, [month, load]);

  function changeMonth(m: string) {
    setError(null);
    navigated.current = true;
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
  const currentUnitName = units.find((u) => u.id === currentUnitId)?.name ?? null;
  // Only an offering the client chose their unit on lets them choose again;
  // on an "auto" offering the assignment is the provider's business.
  const picksUnit = offering?.unitSelection === "client_picks";

  function confirm() {
    const { start, end } = range;
    if (!start || !end) return;
    startTransition(async () => {
      setError(null);
      const result = await rescheduleRentalBooking({
        token,
        // null is the RPC's "keep the current unit if it is still free,
        // else the first free one" — the right default either way.
        unitId: picksUnit ? unitId : null,
        startDate: start,
        endDate: end,
      });
      if (!result.ok) {
        // Inline in every case (it belongs to the panel); a lost-dates
        // failure also resets the picker and refetches, and its message has
        // to survive that reload — the toast would just repeat it.
        setError(result.error);
        if (result.datesTaken) {
          setRange({ start: null, end: null });
          setUnitId(null);
          load(month);
        } else {
          toast.error(result.error);
        }
        return;
      }
      // New booking, new token: the manage link changes.
      toast.success("Stay rescheduled");
      router.push(`/booking/${result.token}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Pick new dates</p>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Keep current dates
        </Button>
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
            <>
              {picksUnit ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rental-reschedule-unit">Unit</Label>
                  <UnitSelect
                    id="rental-reschedule-unit"
                    units={units}
                    freeUnitIds={freeUnitIds}
                    value={unitId}
                    onChange={setUnitId}
                    keepUnitId={currentUnitId}
                    keepUnitName={currentUnitName}
                  />
                </div>
              ) : null}
              <Button onClick={confirm} disabled={pending || !stay?.ok}>
                {pending ? "Rescheduling…" : "Confirm new dates"}
              </Button>
            </>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Times shown in the provider&rsquo;s timezone ({timeZone}).
      </p>
    </div>
  );
}
