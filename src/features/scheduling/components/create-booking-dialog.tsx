"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
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
  open, onOpenChange, date, startMin, timeZone, services, windows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string; // org-local "YYYY-MM-DD"
  startMin: number; // org-local minutes since midnight (snapped)
  timeZone: string;
  services: ServiceRow[];
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
  const endMin = startMin + (service?.durationMin ?? 0);
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
        startsAt: startsAt.toISOString(),
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
            {date} · {startTime}–{service ? minToTime(endMin) : "?"} ({timeZone})
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
          {overlapError ? <p className="text-destructive text-sm">{overlapError}</p> : null}
          <Button type="submit" disabled={pending || !serviceId || tooFarPast}>
            {pending ? "Creating…" : "Create booking"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
