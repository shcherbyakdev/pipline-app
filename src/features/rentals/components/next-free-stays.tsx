"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import type { PublicOffering } from "@/lib/booking/public";
import { asEngineOffering, type RangeAvailability } from "@/features/rentals/range";
import { nextFreeStays, stayLengthOptions } from "@/features/rentals/next-free-stays";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, CHIP, ROW, ROW_LIST, STEP_LABEL } from "@/features/booking-page/render/type";

const SHOW = 8;
// Org-local dates carry no zone: pin the formatter to UTC so the viewer's
// own timezone can never shift a day (range-picker.tsx's convention).
const dayFormatter = (intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

/* Next free stays (widget templates spec §8): pick how long, then the
   soonest windows of that length, one tap each — the hourly flow's
   "How long?" then times, for nights and days. "Later dates" moves the
   two-month window on; "Back to the soonest" returns to this month. */
export function NextFreeStays({
  offering, availability, loading, onPick, onLater, onSooner,
}: {
  offering: PublicOffering;
  availability: RangeAvailability | null;
  loading: boolean;
  onPick: (start: string, end: string) => void;
  onLater: () => void;
  onSooner: (() => void) | null;
}) {
  const locale = useLocale();
  const t = useTranslations("public.stay");
  const tu = useTranslations("public.units");
  const tSlots = useTranslations("public.slots");
  const tManage = useTranslations("public.manage");
  const dayFmt = React.useMemo(() => dayFormatter(INTL_LOCALES[locale]), [locale]);
  const [limit, setLimit] = React.useState(SHOW);
  const lengths = stayLengthOptions(offering);
  const [length, setLength] = React.useState(lengths[0] ?? 1);
  const stays = availability ? nextFreeStays(asEngineOffering(offering), availability, limit + 1, length) : [];
  const shown = stays.slice(0, limit);
  const nights = offering.rangeMode === "nights";
  const plural = (n: number) => tu(nights ? "nights" : "days", { count: n });
  return (
    <div className="flex flex-col gap-3">
      {lengths.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className={STEP_LABEL}>{t(nights ? "howManyNights" : "howManyDays")}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t(nights ? "lengthInNights" : "lengthInDays")}>
            {lengths.map((n) => (
              <Button
                key={n}
                type="button"
                variant="outline"
                role="radio"
                aria-checked={n === length}
                // wt-primary wins over wt-chip on a shared element (globals.css
                // order), but keep them exclusive so the hover lift never
                // fights the picked fill.
                className={cn("h-9 px-3.5", n === length ? "wt-primary border-transparent" : CHIP)}
                onClick={() => {
                  setLength(n);
                  setLimit(SHOW);
                }}
              >
                {plural(n)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-sm">
        <span className="font-medium">{t("nextFree", { length: plural(length) })}</span>{" "}
        <span className="text-muted-foreground">{t("tapToBook")}</span>
      </p>
      <div aria-live="polite" className={loading ? "flex flex-col gap-2 opacity-60 transition-opacity" : "flex flex-col gap-2"}>
        {loading && !availability ? (
          <p className="text-muted-foreground text-sm">{tManage("loadingAvailability")}</p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("nothingFreePeriod")}</p>
        ) : (
          <ul className={ROW_LIST}>
            {shown.map((s) => (
              <li key={s.start}>
                <button type="button" onClick={() => onPick(s.start, s.end)} className={ROW}>
                  <span className="font-medium tabular-nums">
                    {t("range", { start: dayFmt.format(utcDate(s.start)), end: dayFmt.format(utcDate(s.end)) })}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{plural(s.length)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {stays.length > limit ? (
          <Button variant="outline" size="sm" className={cn(CHIP, "h-8 px-3")} onClick={() => setLimit((n) => n + SHOW)}>{tSlots("showMore")}</Button>
        ) : (
          <Button variant="outline" size="sm" className={cn(CHIP, "h-8 px-3")} onClick={onLater}>{tSlots("laterDates")}</Button>
        )}
        {onSooner ? (
          <button type="button" className={CHANGE_LINK} onClick={onSooner}>{tSlots("backToSoonest")}</button>
        ) : null}
      </div>
    </div>
  );
}
