"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { asEngineOffering, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { dateInZone } from "@/features/scheduling/slots";
import {
  getManageRangeAvailability,
  rescheduleRentalBooking,
} from "@/features/rentals/manage-actions";
import { cancelFeeCents, cancelFeePct } from "@/features/rentals/cancel-policy";
import { changeLines, stayUnits, totalCents } from "@/features/rentals/pricing";
import type { UnitsT } from "@/i18n/translator";
import { RangePicker, type RangeValue } from "./range-picker";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";

// Two rendered months are at most 62 days; the turnover tail (≤ 30) has to
// come along or validateStay reads a missing day at the far edge as
// "unavailable". 62 + 30 fits the action's own 93-day cap, so one constant
// covers every offering and the window never has to be refetched when the
// offering's turnover arrives with the first response (move-rental-dialog).
const WINDOW_DAYS = 93;

// S3: what the confirm-step preview prices against — the booking's own
// money/policy, straight off getManageRangeAvailability.
type BookingMoney = Extract<Awaited<ReturnType<typeof getManageRangeAvailability>>, { ok: true }>["booking"];

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
  const t = useTranslations("public.manage");
  const tSlots = useTranslations("public.slots");
  const tUnits = useTranslations("public.units");
  const [month, setMonth] = React.useState(() => monthOf(dateInZone(new Date(), timeZone)));
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [currentUnitId, setCurrentUnitId] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<BookingMoney | null>(null);
  const [range, setRange] = React.useState<RangeValue>({ start: null, end: null });
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // The stay's own month is the useful starting view, but only the server
  // knows its check-in date; the first response jumps there unless the
  // client has already navigated somewhere themselves.
  const navigated = React.useRef(false);
  // Request-ordering guard: a fast month-nav click can fire a second fetch
  // before the first resolves — only the most recent request may ever apply
  // its result.
  const seqRef = React.useRef(0);

  // Deliberately does NOT clear `error`: the datesTaken path reloads
  // availability and wants its message to survive the reload.
  const load = React.useCallback(
    (m: string) => {
      startTransition(async () => {
        const seq = ++seqRef.current;
        const result = await getManageRangeAvailability({
          token,
          fromDate: firstOfMonth(m),
          days: WINDOW_DAYS,
        });
        if (seq !== seqRef.current) return;
        if (result.ok) {
          setAvailability(result.availability);
          setOffering(result.offering);
          setUnits(result.units);
          setCurrentUnitId(result.currentUnitId);
          setBooking(result.booking);
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
      ? validateStay(asEngineOffering(offering), availability, range.start, range.end)
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
      toast.success(t("stayRescheduled"));
      router.push(`/booking/${result.token}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("pickNewDates")}</p>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          {t("keepCurrentDates")}
        </Button>
      </div>

      {offering === null ? (
        <p className="text-muted-foreground text-sm">{error ?? t("loadingAvailability")}</p>
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
              {stay?.ok && booking && offering ? (
                <ChangePreviewStay booking={booking} offering={offering} start={range.start} end={range.end} t={tUnits} />
              ) : null}
              {picksUnit ? (
                <UnitSelect
                  id="rental-reschedule-unit"
                  label={t("unit")}
                  units={units}
                  freeUnitIds={freeUnitIds}
                  value={unitId}
                  onChange={setUnitId}
                  keepUnitId={currentUnitId}
                  keepUnitName={currentUnitName}
                />
              ) : null}
              <Button onClick={confirm} disabled={pending || !stay?.ok}>
                {pending ? t("rescheduling") : t("confirmNewDates")}
              </Button>
            </>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
      )}
      <p className="text-muted-foreground text-xs">{tSlots("providerTz", { tz: timeZone })}</p>
    </div>
  );
}

/* S3: what this move would mean, priced the way the flat/per-unit total is
   (totalCents on the offering's own rate) plus the tier fee the OLD start
   incurs right now. Preview only — the RPC writes the numbers. */
function ChangePreviewStay({
  booking, offering, start, end, t,
}: {
  booking: BookingMoney; offering: PublicOffering; start: string; end: string; t: UnitsT;
}) {
  const now = new Date();
  const startsAt = new Date(booking.startsAt);
  const feePct = cancelFeePct(booking.cancelPolicy, startsAt, now);
  const feeCents = cancelFeeCents(booking.cancelPolicy, booking.priceCents, startsAt, now);
  const newTotalCents = totalCents(offering, stayUnits(offering.rangeMode as "nights" | "days", start, end));
  const out = changeLines(
    { newTotalCents, currency: booking.currency, feeCents, feePct, priorFeeCents: booking.feeCents, paidCents: booking.paidCents, refundedCents: booking.refundedCents },
    t,
  );
  if (out.length === 0) return null;
  return (
    <ul className="text-sm">
      {out.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}
