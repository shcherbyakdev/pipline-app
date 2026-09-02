"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";
import {
  getAdminSlots,
  rescheduleBookingAdmin,
} from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { INTL_LOCALES } from "@/i18n/config";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogTrigger,
  dialogPanelClass,
  dialogPillClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Slot days are org-local (getAdminSlots walks `fromDate` in the org's
// zone), so the week the picker opens on — and the floor it can't go
// before — is the org's today, not UTC's.
const todayISO = (timeZone: string) => dateInZone(new Date(), timeZone);

// "Week of Mon 24 Aug": noon UTC pins the calendar date whatever the
// browser's offset (date-overrides.tsx precedent).
const weekLabel = (date: string, intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const slotLabel = (iso: string, intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function BookingRescheduleDialog({
  booking,
  timeZone,
  eligibleStaff,
}: {
  // Appointments only: the slot picker needs a service. Call sites narrow
  // `serviceId` (rentals are filtered out before this renders).
  booking: AdminBooking & { serviceId: string };
  timeZone: string;
  // Team (multi-staff): the active members who offer this service, computed
  // by the caller (which is the side that knows the service↔staff links).
  // One entry (the solo case) ⇒ no picker, and this dialog is the pre-team
  // one down to the pixel.
  eligibleStaff: StaffRow[];
}) {
  const t = useTranslations("bookings");
  const tCommon = useTranslations("common");
  const intlLocale = INTL_LOCALES[useLocale()];
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [fromDate, setFromDate] = React.useState(() => todayISO(timeZone));
  const [slots, setSlots] = React.useState<string[] | null>(null);
  // null = untouched ⇒ the person the booking already belongs to. A booking
  // whose owner is no longer eligible (deactivated, service unlinked) falls
  // through to the first person who is — moving it is the way out.
  const [picked, setPicked] = React.useState<string | null>(null);
  const eligible = (id: string | null) =>
    id !== null && eligibleStaff.some((s) => s.id === id);
  const staffId =
    (eligible(picked) ? picked : null) ??
    (eligible(booking.staffId) ? booking.staffId : eligibleStaff[0]?.id) ??
    "";

  const loadSlots = (date: string, forStaffId: string) => {
    if (!forStaffId) return setSlots([]);
    startTransition(async () => {
      const res = await getAdminSlots({
        serviceId: booking.serviceId,
        staffId: forStaffId,
        fromDate: date,
        days: 7,
      });
      if (!res.ok) toast.error(res.error);
      else setSlots(res.slots);
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) loadSlots(fromDate, staffId);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO(timeZone)) return;
    setFromDate(next);
    loadSlots(next, staffId);
  };

  // Another person's week is a different grid — reload rather than let the
  // old member's free times stand in for theirs.
  const changeStaff = (id: string) => {
    setPicked(id);
    setSlots(null);
    loadSlots(fromDate, id);
  };

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBookingAdmin({
        id: booking.id,
        startsAt,
        // Omitted when it is the same person: "keep the current staff" is
        // the RPC's own default, and this stays a plain time move.
        staffId: staffId === booking.staffId ? undefined : staffId,
      });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate, staffId);
      } else {
        const name = res.movedToStaffName ?? "none";
        if (res.noEmail) toast.success(t("reschedule.movedNoEmail", { name }));
        else if (res.emailed) toast.success(t("reschedule.movedEmailed", { name }));
        else toast.warning(t("reschedule.movedEmailFailed"));
        setOpen(false);
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("reschedule.button")}
          </Button>
        }
      />
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="time">{booking.serviceName}</DialogChip>}
        >
          {t("reschedule.title", { name: booking.clientName })}
        </DialogBreadcrumbHeader>
        <div className="flex flex-col gap-4 px-5 pt-4 pb-6">
          {eligibleStaff.length > 1 ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="rs-staff">{t("reschedule.moveTo")}</Label>
              <span className="relative inline-flex">
                <select
                  id="rs-staff"
                  className={cn(dialogPillClass, "appearance-none pr-6")}
                  value={staffId}
                  disabled={pending}
                  onChange={(e) => changeStaff(e.target.value)}
                >
                  {eligibleStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon
                  aria-hidden
                  className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2"
                />
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              {t("reschedule.weekOf", { date: weekLabel(fromDate, intlLocale) })}
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(-7)}
                disabled={pending || fromDate <= todayISO(timeZone)}
                aria-label={t("prevWeek")}
              >
                ←
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(7)}
                disabled={pending}
                aria-label={t("nextWeek")}
              >
                →
              </Button>
            </div>
          </div>
          {slots === null ? (
            <p className="text-muted-foreground text-sm">{tCommon("loading")}</p>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reschedule.noFreeTimes")}</p>
          ) : (
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
              {slots.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => pick(s)}
                >
                  {slotLabel(s, intlLocale)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">{t("reschedule.tzNote", { tz: timeZone })}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
