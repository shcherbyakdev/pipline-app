"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { minToTime, snap15, timeToMin, zonedParts } from "@/features/scheduling/calendar-geometry";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogFooter,
  dialogBareInputClass as bareInputClass,
  dialogPillClass as pillClass,
} from "@/components/ui/dialog";
import { TIME_OPTIONS, endOptions } from "@/features/scheduling/time-options";
import { DatePicker } from "./date-picker";
import { TimeCombobox } from "./time-combobox";
import { cn } from "@/lib/utils";

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* The appointment half of the New-booking dialog (admin IA spec §2). The
   shell owns WHICH service; this form owns when, who and for whom. Opened
   from a drag it is prefilled and keeps the drag's default length; opened
   from the toolbar it starts on today at the next quarter hour — the one
   thing the old drag-only dialog could not do. */
export type DragPrefill = { date: string; startMin: number; dragEndMin: number; dragged: boolean; windows: DayWindow[] };

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
  const t = useTranslations("bookings");
  const tCommon = useTranslations("common");
  const tUnits = useTranslations("public.units");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const service = services.find((s) => s.id === serviceId);

  // Date + start are editable; the drag seeds them. `new Date()` inside the
  // useState initializer is the booking forms' seeded-now idiom — it runs
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
  // End time is editable. Default: a real drag sets the LENGTH, not a fixed
  // end clock time — so editing the start later carries the same length
  // forward instead of pinning the old end. A click (the grid says so via
  // `dragged`) follows the picked service's duration instead, so switching
  // services in the dialog re-lengthens the slot. Until the user touches
  // the end, it follows the start.
  const dragged = drag !== null && drag.dragged;
  const defaultLengthMin = dragged && drag ? drag.dragEndMin - drag.startMin : (service?.durationMin ?? 60);
  const defaultEndMin = startMin + defaultLengthMin;
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
      if (result.emailed === "sent") toast.success(t("create.doneEmailed"));
      else if (result.emailed === "failed")
        toast.warning(t("create.doneEmailFailed"));
      else toast.success(t("create.done"));
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col">
      <div className="flex flex-col px-5 pt-5 pb-6">
        <input
          aria-label={t("form.clientName")}
          required
          maxLength={200}
          value={name}
          placeholder={t("form.clientName")}
          className={cn(bareInputClass, "text-[15px] font-medium")}
          onChange={(e) => { setName(e.target.value); clearOverlap(); }}
        />
        <input
          aria-label={t("form.email")}
          type="email"
          maxLength={320}
          value={email}
          placeholder={t("form.email")}
          className={cn(bareInputClass, "mt-3 text-sm")}
          onChange={(e) => { setEmail(e.target.value); clearOverlap(); }}
        />
        <textarea
          aria-label={t("form.note")}
          maxLength={2000}
          rows={2}
          value={note}
          placeholder={t("form.notePlaceholder")}
          className={cn(bareInputClass, "mt-3 resize-none text-sm")}
          onChange={(e) => { setNote(e.target.value); clearOverlap(); }}
        />
        {/* The app's own pickers in the pill dress — the native date/time
            inputs wore browser chrome no theme could reach. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <DatePicker
            label={t("form.date")}
            value={date}
            className={pillClass}
            onCommit={(d) => { setDate(d); clearOverlap(); }}
          />
          <TimeCombobox
            label={t("form.startsAt", { tz: timeZone })}
            value={startTime}
            options={TIME_OPTIONS}
            className={cn(pillClass, "w-20 text-center")}
            onCommit={(hm) => { setStartTime(hm); clearOverlap(); }}
          />
          <span aria-hidden className="text-muted-foreground text-xs">–</span>
          <TimeCombobox
            label={t("form.endsAt")}
            value={effectiveEndTime}
            options={endOptions(startTime)}
            className={cn(pillClass, "w-20 text-center")}
            onCommit={(hm) => { setEndTouched(true); setEndTime(hm); clearOverlap(); }}
          />
          {activeStaff.length > 1 ? (
            <span className="relative inline-flex">
              <select
                aria-label={t("teamMember")}
                className={cn(pillClass, "appearance-none pr-6")}
                value={staffId}
                disabled={eligible.length === 0}
                onChange={(e) => { setPickedStaffId(e.target.value); clearOverlap(); }}
              >
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDownIcon aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2" />
            </span>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {durationMin > 0 ? tUnits("minutes", { count: durationMin }) : "—"} · {timeZone}
          </span>
        </div>
        {outsideHours ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
            {t("form.outsideHours")}
          </p>
        ) : null}
        {insideNotice && !tooFarPast ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
            {t("form.insideNotice")}
          </p>
        ) : null}
        {tooFarPast ? (
          <p className="text-destructive mt-3 text-xs">
            {t("form.tooFarPast")}
          </p>
        ) : null}
        {invalidDuration ? (
          <p className="text-destructive mt-3 text-xs">
            {t("form.invalidDuration")}
          </p>
        ) : null}
        {serviceId && !staffId ? (
          <p className="text-destructive mt-3 text-xs">
            {t("form.nobodyOffers")}
          </p>
        ) : null}
        {overlapError ? <p className="text-destructive mt-3 text-xs">{overlapError}</p> : null}
      </div>
      <DialogFooter className="mx-0 mb-0 items-center rounded-b-3xl px-5">
        <Button
          type="submit"
          size="sm"
          variant="brand"
          disabled={pending || !serviceId || !staffId || tooFarPast || invalidDuration || !validDate || !validStart}
        >
          {pending ? tCommon("creating") : t("create.button")}
        </Button>
      </DialogFooter>
    </form>
  );
}
