"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { addDaysISO } from "@/features/scheduling/slots";
import {
  cancelBooking,
  getManageSlots,
  rescheduleBooking,
} from "@/features/scheduling/manage-actions";
import { RentalReschedulePanel } from "@/features/rentals/components/rental-reschedule-panel";
import { HourlyReschedulePanel } from "@/features/rentals/components/hourly-reschedule-panel";
import { INTL_LOCALES } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { PagerDiscs } from "@/features/scheduling/components/slot-layouts/frame";

// The viewer's local date (booking-widget's rule; getManageSlots pads its
// engine window a day each side, the picker keeps what lands on its page).
const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const viewerDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const slotLabel = (iso: string, intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function ManageBooking({
  token,
  timeZone,
  canReschedule,
  canCancel,
  kind,
  rangeMode,
  request,
}: {
  token: string;
  timeZone: string;
  // Whether self-serve rescheduling is offered at all (cancel is always).
  canReschedule: boolean;
  // H3: false once a rental's free-cancellation window has elapsed — hides
  // the cancel button and shows errors.cancelWindowPassed instead. Always true for
  // appointments and rentals with no cancel window (page.tsx computes it).
  // Reschedule is unaffected either way.
  canCancel: boolean;
  // Rentals R2: a stay picks a date RANGE, not a slot — the same
  // Reschedule button opens a range picker instead of the slot grid.
  kind: "appointment" | "rental";
  // Rentals only (H2): which reschedule surface a booking gets — the range
  // picker (nights/days) or the hourly time grid. Null for an appointment,
  // which never reads it (kind === "appointment" always wins the branch
  // below).
  rangeMode: "nights" | "days" | "hours" | null;
  // Booking approval: a still-pending request cancels through the same
  // cancel_booking action, just with "withdraw" wording — nothing else
  // about the flow changes.
  request?: boolean;
}) {
  const t = useTranslations("public.manage");
  const ts = useTranslations("public.slots");
  const tc = useTranslations("common");
  const tErrors = useTranslations("errors");
  const intl = INTL_LOCALES[useLocale()];
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);
  // A picked slot waits for an explicit confirm (audit 2026-08-24: one
  // mis-click used to move the booking and email everyone).
  const [candidate, setCandidate] = React.useState<string | null>(null);

  const loadSlots = (date: string) => {
    setCandidate(null);
    startTransition(async () => {
      const res = await getManageSlots({ token, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else {
        const last = addDaysISO(date, 6);
        setSlots(res.slots.filter((s) => viewerDay(s) >= date && viewerDay(s) <= last));
      }
    });
  };

  const openPicker = () => {
    setPicking(true);
    // A stay's panel loads its own range availability by token.
    if (kind === "appointment") loadSlots(fromDate);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO()) return;
    setFromDate(next);
    loadSlots(next);
  };

  const doCancel = () =>
    startTransition(async () => {
      const res = await cancelBooking({ token });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(t("cancelled"));
        router.refresh();
      }
    });

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBooking({ token, startsAt });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate);
      } else {
        // New booking, new token: the manage link changes.
        router.push(`/booking/${res.token}`);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {!canReschedule ? null : !picking ? (
        <Button variant="outline" onClick={openPicker} disabled={pending}>
          {t("reschedule")}
        </Button>
      ) : kind === "rental" ? (
        rangeMode === "hours" ? (
          <HourlyReschedulePanel
            token={token}
            timeZone={timeZone}
            onCancel={() => setPicking(false)}
          />
        ) : (
          <RentalReschedulePanel
            token={token}
            timeZone={timeZone}
            onCancel={() => setPicking(false)}
          />
        )
      ) : (
        <div className="bg-secondary flex flex-col gap-3 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{t("pickNewTime")}</p>
            <PagerDiscs
              prevDisabled={pending || fromDate <= todayISO()}
              nextDisabled={pending}
              onPrev={() => nav(-7)}
              onNext={() => nav(7)}
              prevLabel={ts("prevWeek")}
              nextLabel={ts("nextWeek")}
            />
          </div>
          {slots === null ? (
            <p className="text-muted-foreground text-sm">{tc("loading")}</p>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">{ts("emptyWeek")}</p>
          ) : candidate ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {t.rich("moveTo", { when: slotLabel(candidate, intl), b: (c) => <span className="font-medium">{c}</span> })}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => pick(candidate)} disabled={pending}>
                  {t("confirmNewTime")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCandidate(null)} disabled={pending}>
                  {t("pickAnother")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  className="h-9 tabular-nums"
                  disabled={pending}
                  onClick={() => setCandidate(s)}
                >
                  {slotLabel(s, intl)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">{ts("localTzProviderIn", { tz: timeZone })}</p>
        </div>
      )}
      {!canCancel ? (
        <p className="text-muted-foreground text-xs">{tErrors("cancelWindowPassed")}</p>
      ) : confirmingCancel ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={doCancel} disabled={pending}>
            {request ? t("withdrawConfirm") : t("cancelConfirm")}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={pending}>
            {t("keepIt")}
          </Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={pending}>
          {request ? t("withdraw") : t("cancel")}
        </Button>
      )}
      {!canReschedule || (kind === "rental" && !picking) ? (
        // Rentals: the range line above is in the provider's zone, and
        // outside the open panel (which says so itself) nothing else does.
        <p className="text-muted-foreground text-xs">{ts("providerTz", { tz: timeZone })}</p>
      ) : null}
    </div>
  );
}
