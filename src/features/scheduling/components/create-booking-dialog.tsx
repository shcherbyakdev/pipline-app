"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { minToTime, timeToMin } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function CreateBookingDialog({
  open, onOpenChange, date, startMin, dragEndMin, timeZone, services, staff, defaultStaffId, windows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string; // org-local "YYYY-MM-DD"
  startMin: number; // org-local minutes since midnight (snapped)
  dragEndMin: number; // selection end — a real drag (>1 snap unit) sets the default length
  timeZone: string;
  services: ServiceRow[];
  // Team (multi-staff): a walk-in belongs to someone. The picker only appears
  // for a real team — a solo org sends its one member's id silently and the
  // dialog looks exactly as it did before the team slice.
  staff: StaffRow[];
  defaultStaffId: string;
  windows: DayWindow[]; // effective windows for `date`, for the warning only
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
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
  // setTimeout-seed idiom calendar-week.tsx uses for its now-line — a plain
  // `setState` in the effect body would itself trip react-hooks/set-state-in-effect.
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(seed);
  }, []);

  const service = services.find((s) => s.id === serviceId);
  // Who can take this service (0040 links), among active members. Changing
  // the service re-derives it, so an ineligible pick can never survive.
  const activeStaff = staff.filter((s) => s.active);
  const eligible = activeStaff.filter((s) => service?.staffIds.includes(s.id));
  // null = untouched; the effective value falls back to the calendar's
  // default person, then to whoever is left.
  const [pickedStaffId, setPickedStaffId] = React.useState<string | null>(null);
  const staffId =
    (pickedStaffId && eligible.some((s) => s.id === pickedStaffId) ? pickedStaffId : null) ??
    (eligible.some((s) => s.id === defaultStaffId) ? defaultStaffId : eligible[0]?.id) ??
    "";
  // End time is editable. Default: a real drag (more than one 15-min snap
  // unit) sets the length; a plain click uses the service duration. Picking
  // a different service resets the end only while the user hasn't touched it.
  const dragged = dragEndMin - startMin > 15;
  const defaultEndMin = dragged ? dragEndMin : startMin + (service?.durationMin ?? 60);
  const [endTouched, setEndTouched] = React.useState(false);
  const [endTime, setEndTime] = React.useState(minToTime(Math.min(defaultEndMin, 24 * 60 - 1)));
  const effectiveEndTime = endTouched ? endTime : minToTime(Math.min(defaultEndMin, 24 * 60 - 1));
  const endMin = timeToMin(effectiveEndTime);
  const durationMin = endMin - startMin;
  const invalidDuration = durationMin < 5 || durationMin > 480;
  const startTime = minToTime(startMin);
  const startsAt = wallTimeToUtc(date, startTime, timeZone);

  const outsideHours =
    !windows.some((w) => timeToMin(w.startTime) <= startMin && endMin <= timeToMin(w.endTime));
  const insideNotice =
    service && nowMs !== null ? startsAt.getTime() < nowMs + service.minNoticeMin * 60_000 : false;
  // The create_booking_admin RPC rejects starts older than 24h (walk-in
  // grace window) — surface that here instead of letting the submit fail
  // with a generic error.
  const tooFarPast = nowMs !== null && startsAt.getTime() < nowMs - 24 * 60 * 60 * 1000;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
      onOpenChange(false);
      setName(""); setEmail(""); setNote("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            {date} · {startTime}–{effectiveEndTime} ({timeZone})
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-service">Service</Label>
            <select
              id="cb-service"
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); clearOverlap(); }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>
              ))}
            </select>
          </div>
          {activeStaff.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cb-staff">Team member</Label>
              <select
                id="cb-staff"
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
            <Label htmlFor="cb-end">
              Ends at{" "}
              <span className="text-muted-foreground font-normal">
                ({durationMin > 0 ? `${durationMin} min` : "—"})
              </span>
            </Label>
            <Input
              id="cb-end"
              type="time"
              step={300}
              value={effectiveEndTime}
              onChange={(e) => {
                setEndTouched(true);
                setEndTime(e.target.value);
                clearOverlap();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-name">Client name</Label>
            <Input
              id="cb-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => { setName(e.target.value); clearOverlap(); }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-email">Email (optional — confirmation is sent only if given)</Label>
            <Input
              id="cb-email"
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearOverlap(); }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-note">Note (optional)</Label>
            <Textarea
              id="cb-note"
              maxLength={2000}
              value={note}
              onChange={(e) => { setNote(e.target.value); clearOverlap(); }}
            />
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
            disabled={pending || !serviceId || !staffId || tooFarPast || invalidDuration}
          >
            {pending ? "Creating…" : "Create booking"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
