"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { getManageHourlySlots, rescheduleRentalBookingHours } from "@/features/rentals/manage-actions";
import { formatHourlyWhenLine } from "@/features/scheduling/templates";
import { TimeSlotGrid } from "@/features/scheduling/components/time-slot-grid";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

type HourlySlot = { startsAt: string; unitIds: string[] };

// The hourly counterpart of RentalReschedulePanel: a client picking a new
// TIME for their own booking from the tokenized manage page —
// TimeSlotGrid instead of a date-range calendar. Duration is never
// renegotiated here (same-duration ruling): it comes back from
// getManageHourlySlots as the booking's own span, and the confirm step
// only ever sends a `startsAt` — never a duration — to the server.
export function HourlyReschedulePanel({
  token,
  timeZone,
  onCancel,
}: {
  token: string;
  timeZone: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<HourlySlot[]>([]);
  const [durationMin, setDurationMin] = React.useState<number | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [currentUnitId, setCurrentUnitId] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  // Request-ordering guard (house pattern, hourly-booking-flow.tsx idiom): a
  // fast week-nav click can fire a second fetch before the first resolves —
  // only the most recent request may ever apply its result.
  const seqRef = React.useRef(0);

  // Deliberately does NOT clear `error`: the datesTaken retry below reloads
  // slots and wants its message to survive the reload (RentalReschedulePanel's
  // `load` idiom).
  const load = React.useCallback(
    (date: string) => {
      startTransition(async () => {
        const seq = ++seqRef.current;
        const result = await getManageHourlySlots({ token, fromDate: date, days: 7 });
        if (seq !== seqRef.current) return;
        if (result.ok) {
          setSlots(result.slots);
          setDurationMin(result.durationMin);
          setOffering(result.offering);
          setUnits(result.units);
          setCurrentUnitId(result.currentUnitId);
        } else {
          setSlots([]);
          setError(result.error);
        }
      });
    },
    [token],
  );

  React.useEffect(() => {
    load(fromDate);
  }, [fromDate, load]);

  function navigate(next: string) {
    setError(null);
    setFromDate(next);
  }
  function pickSlot(iso: string) {
    setError(null);
    setUnitId(null);
    setSlot(iso);
  }
  function backToTime() {
    setError(null);
    setSlot(null);
    setUnitId(null);
  }

  const matchingSlot = slot ? slots.find((s) => s.startsAt === slot) : undefined;
  const freeUnitIds = matchingSlot ? matchingSlot.unitIds : null;
  const currentUnitName = units.find((u) => u.id === currentUnitId)?.name ?? null;
  // Only an offering the client chose their unit on lets them choose again;
  // on an "auto" offering the assignment is the provider's business.
  const picksUnit = offering?.unitSelection === "client_picks";

  function confirm() {
    if (!slot) return;
    startTransition(async () => {
      setError(null);
      const result = await rescheduleRentalBookingHours({
        token,
        // null is the RPC's "keep the current unit if it is still free,
        // else the first free one" — the right default either way.
        unitId: picksUnit ? unitId : null,
        startsAt: slot,
      });
      if (!result.ok) {
        // Inline in every case (it belongs to the panel); a lost-slot
        // failure also resets the picker and refetches, and its message has
        // to survive that reload — the toast would just repeat it.
        setError(result.error);
        if (result.datesTaken) {
          setSlot(null);
          setUnitId(null);
          load(fromDate);
        } else {
          toast.error(result.error);
        }
        return;
      }
      // New booking, new token: the manage link changes.
      toast.success("Booking rescheduled");
      router.push(`/booking/${result.token}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Pick a new time</p>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Keep current time
        </Button>
      </div>

      {offering === null ? (
        <p className="text-muted-foreground text-sm">{error ?? "Loading availability…"}</p>
      ) : !slot ? (
        <TimeSlotGrid
          slots={slots.map((s) => s.startsAt)}
          fromDate={fromDate}
          todayISO={todayISO()}
          pending={pending}
          orgTimeZone={timeZone}
          onNavigate={navigate}
          onPick={pickSlot}
          regionRef={slotsRegionRef}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {durationMin
              ? formatHourlyWhenLine(new Date(slot), new Date(new Date(slot).getTime() + durationMin * 60_000), timeZone)
              : null}{" "}
            <button type="button" className="text-muted-foreground underline" onClick={backToTime}>
              change
            </button>
          </p>
          {picksUnit ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hourly-reschedule-unit">Unit</Label>
              <UnitSelect
                id="hourly-reschedule-unit"
                units={units}
                freeUnitIds={freeUnitIds}
                value={unitId}
                onChange={setUnitId}
                keepUnitId={currentUnitId}
                keepUnitName={currentUnitName}
              />
            </div>
          ) : null}
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Rescheduling…" : "Confirm new time"}
          </Button>
        </div>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <p className="text-muted-foreground text-xs">
        Times shown in the provider&rsquo;s timezone ({timeZone}).
      </p>
    </div>
  );
}
