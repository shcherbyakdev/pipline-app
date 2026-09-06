"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { moneyInfoLines, totalCents, depositCents, type MoneyFields } from "@/features/rentals/pricing";
import { cn } from "@/lib/utils";


// Confirm-step money block, shared by RentalBookingFlow and
// HourlyBookingFlow. `units` is the nights/days count (range flow) or
// durationMin / 60 (hourly flow) — null while the picker hasn't settled on
// a stay/slot yet, which shows the deposit/terms without a total. Renders
// nothing when the offering carries no money AND no terms (pre-H3 shape).
export function BookingMoneySummary({
  offering,
  currency,
  units,
  termsAccepted,
  onTermsChange,
  idPrefix = "",
}: {
  offering: MoneyFields & { cancelWindowMin: number; termsText: string | null };
  currency: string;
  units: number | null;
  termsAccepted: boolean;
  onTermsChange: (v: boolean) => void;
  idPrefix?: string;
}) {
  const t = useTranslations("public.stay");
  const tu = useTranslations("public.units");
  const total = units === null ? null : totalCents(offering, units);
  const deposit = depositCents(offering, total);
  const lines = moneyInfoLines(
    { totalCents: total, depositCents: deposit, currency, cancelWindowMin: offering.cancelWindowMin },
    tu,
  );
  if (lines.length === 0 && offering.termsText === null) return null;
  const termsId = `${idPrefix}terms-accepted`;
  return (
    <div className={cn("flex flex-col gap-2 border-t pt-4 text-sm")}>
      {/* moneyInfoLines puts the total first whenever there is one. */}
      {lines.map((l, i) => (
        <p key={l} className={cn("tabular-nums", i === 0 && total !== null ? "font-medium" : "text-muted-foreground")}>
          {l}
        </p>
      ))}
      {offering.termsText !== null ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <Checkbox
              id={termsId}
              required
              checked={termsAccepted}
              onCheckedChange={(checked) => onTermsChange(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor={termsId} className="text-sm font-normal">
              {t("acceptTerms")}
            </Label>
          </div>
          <details className="ml-6">
            <summary className="text-muted-foreground cursor-pointer text-xs">{t("showTerms")}</summary>
            <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{offering.termsText}</p>
          </details>
        </div>
      ) : null}
    </div>
  );
}
