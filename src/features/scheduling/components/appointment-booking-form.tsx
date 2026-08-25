"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { minToTime, snap15, timeToMin, zonedParts } from "@/features/scheduling/calendar-geometry";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* The appointment half of the New-booking dialog (admin IA spec §2). The
   shell owns WHICH service; this form owns when, who and for whom. Opened
   from a drag it is prefilled and keeps the drag's default length; opened
   from the toolbar it starts on today at the next quarter hour — the one
   thing the old drag-only dialog could not do. */
export type DragPrefill = { date: string; startMin: number; dragEndMin: number; windows: DayWindow[] };

export function AppointmentBookingForm({
  serviceId, services, staff, defaultStaffId, timeZone, drag, onDone,
}: {
  serviceId: string;
  services: ServiceRow[];
  // Team (multi-staff): a walk-in belongs to someone. The picker only appears
  // for a real team — a solo org sends its one member's id silently.
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
  drag: DragPrefill | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const service = services.find((s) => s.id === serviceId);

  // Date + start are editable; the drag seeds them. `new Date()` inside the
  // useState initializer is the new-rental-booking-dialog precedent — it runs
  // once, not on every render.
  const [date, setDate] = React.useState(() => drag?.date ?? dateInZone(new Date(), timeZone));
  const [startTime, setStartTime] = React.useState(() =>
    drag ? minToTime(drag.startMin) : minToTime(Math.min(snap15(zonedParts(new Date(), timeZone).minutes) + 15, 23 * 60 + 45)),
  );
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");
  // Overlap failures render inline (spec: this is a validation error tied
  // to the form, not a fire-and-forget notification) rather than only a
  // toast; cleared on the next submit or whenever an input changes so a
  // stale error can't linger against edited values.
  const [overlapError, setOverlapError] = React.useState<string | null>(null);
  const clearOverlap = () => setOverlapError(null);

  // `Date.now()` is an impure call and react-hooks/purity (React Compiler
  // rule) forbids calling it during render. Snapshot it once via the same
  // setTimeout-seed idiom calendar-week.tsx uses for its now-line.
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(seed);
  }, []);

  // Who can take this service (0040 links), among active members.
  const activeStaff = staff.filter((s) => s.active);
  const eligible = activeStaff.filter((s) => service?.staffIds.includes(s.id));
  const [pickedStaffId, setPickedStaffId] = React.useState<string | null>(null);
  const staffId =
    (pickedStaffId && eligible.some((s) => s.id === pickedStaffId) ? pickedStaffId : null) ??
    (eligible.some((s) => s.id === defaultStaffId) ? defaultStaffId : eligible[0]?.id) ??
    "";

  const validStart = TIME_RE.test(startTime);
  const validDate = DATE_RE.test(date) && !Number.isNaN(new Date(`${date}T12:00:00Z`).getTime());
  const startMin = validStart ? timeToMin(startTime) : 0;
  // End time is editable. Default: a real drag (more than one 15-min snap
  // unit) sets the length; otherwise the service duration. Until the user
  // touches the end, it follows the start and the service.
  const dragged = drag !== null && drag.dragEndMin - drag.startMin > 15;
  const defaultEndMin = dragged && drag ? drag.dragEndMin : startMin + (service?.durationMin ?? 60);
  const [endTouched, setEndTouched] = React.useState(false);
  const [endTime, setEndTime] = React.useState(minToTime(Math.min(defaultEndMin, 24 * 60 - 1)));
  const effectiveEndTime = endTouched ? endTime : minToTime(Math.min(defaultEndMin, 24 * 60 - 1));
  const endMin = timeToMin(effectiveEndTime);
  const durationMin = endMin - startMin;
  const invalidDuration = durationMin < 5 || durationMin > 480;
  const startsAt = validDate && validStart ? wallTimeToUtc(date, startTime, timeZone) : null;

  // The outside-hours hint is advisory and only meaningful for the day the
  // drag came from — the form has no windows for any other date, and admin
  // bookings ignore hours anyway.
  const outsideHours =
    drag !== null &&
    date === drag.date &&
    !drag.windows.some((w) => timeToMin(w.startTime) <= startMin && endMin <= timeToMin(w.endTime));
  const insideNotice =
    service && nowMs !== null && startsAt ? startsAt.getTime() < nowMs + service.minNoticeMin * 60_000 : false;
  // The create_booking_admin RPC rejects starts older than 24h (walk-in
  // grace window) — surface that here instead of letting the submit fail.
  const tooFarPast = nowMs !== null && startsAt !== null && startsAt.getTime() < nowMs - 24 * 60 * 60 * 1000;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startsAt) return;
    setOverlapError(null);
    startTransition(async () => {
      const result = await createBookingAdmin({
        serviceId,
        staffId,
        startsAt: startsAt.toISOString(),
        durationMin,
        name,
        email,
        note: note || undefined,
      });
      if (!result.ok) {
        if (result.overlap) setOverlapError(result.error);
        else toast.error(result.error);
        return;
      }
      if (result.emailed === "sent") toast.success("Booking created — the client has been emailed");
      else if (result.emailed === "failed")
        toast.warning("Booking created — but the confirmation email failed. Contact the client directly.");
      else toast.success("Booking created.");
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-date">Date</Label>
          <Input
            id="ab-date"
            type="date"
            required
            value={date}
            onChange={(e) => { setDate(e.target.value); clearOverlap(); }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-start">Starts at</Label>
          <Input
            id="ab-start"
            type="time"
            step={900}
            required
            value={startTime}
            onChange={(e) => { setStartTime(e.target.value); clearOverlap(); }}
          />
        </div>
      </div>
      {activeStaff.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-staff">Team member</Label>
          <select
            id="ab-staff"
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
            value={staffId}
            disabled={eligible.length === 0}
            onChange={(e) => { setPickedStaffId(e.target.value); clearOverlap(); }}
          >
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-end">
          Ends at{" "}
          <span className="text-muted-foreground font-normal">
            ({durationMin > 0 ? `${durationMin} min` : "—"})
          </span>
        </Label>
        <Input
          id="ab-end"
          type="time"
          step={300}
          value={effectiveEndTime}
          onChange={(e) => { setEndTouched(true); setEndTime(e.target.value); clearOverlap(); }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-name">Client name</Label>
        <Input id="ab-name" required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); clearOverlap(); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-email">Email (optional — confirmation is sent only if given)</Label>
        <Input id="ab-email" type="email" maxLength={320} value={email} onChange={(e) => { setEmail(e.target.value); clearOverlap(); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-note">Note (optional)</Label>
        <Textarea id="ab-note" maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); clearOverlap(); }} />
      </div>
      {outsideHours ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Outside your open hours — allowed for bookings you create yourself.
        </p>
      ) : null}
      {insideNotice && !tooFarPast ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Inside this service’s minimum-notice window — allowed for bookings you create yourself.
        </p>
      ) : null}
      {tooFarPast ? (
        <p className="text-destructive text-sm">
          This time is more than 24 hours in the past — bookings can’t be recorded that far
          back. Pick a slot from the last day, or a future one.
        </p>
      ) : null}
      {invalidDuration ? (
        <p className="text-destructive text-sm">
          End must be after the start — between 5 minutes and 8 hours long.
        </p>
      ) : null}
      {serviceId && !staffId ? (
        <p className="text-destructive text-sm">
          Nobody on the team offers this service yet — assign someone on the Services page.
        </p>
      ) : null}
      {overlapError ? <p className="text-destructive text-sm">{overlapError}</p> : null}
      <Button
        type="submit"
        disabled={pending || !serviceId || !staffId || tooFarPast || invalidDuration || !validDate || !validStart}
      >
        {pending ? "Creating…" : "Create booking"}
      </Button>
    </form>
  );
}
