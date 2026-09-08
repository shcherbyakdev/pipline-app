"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { moneyInfoLines, depositCents, type MoneyFields } from "@/features/rentals/pricing";
import type { Line } from "@/features/rentals/pricing-rules";
import type { CancelPolicy } from "@/features/rentals/cancel-policy";
import { cn } from "@/lib/utils";


// Confirm-step money block, shared by RentalBookingFlow and
// HourlyBookingFlow. The caller now does the quoting (S1's rules-aware
// hourly flow and the nights/days flat total are computed differently) and
// hands down the result: `lines` is the itemised breakdown (null while the
// picker hasn't settled, [] for an unpriced offering) and `totalCents` its
// sum. Renders nothing when the offering carries no money AND no terms
// (pre-H3 shape).
export function BookingMoneySummary({
  offering,
  currency,
  lines,
  totalCents,
  termsAccepted,
  onTermsChange,
  idPrefix = "",
}: {
  offering: MoneyFields & { cancelPolicy: CancelPolicy; termsText: string | null };
  currency: string;
  /** The quote (S1) — null while the picker hasn't settled; [] for an unpriced offering. */
  lines: Line[] | null;
  totalCents: number | null;
  termsAccepted: boolean;
  onTermsChange: (v: boolean) => void;
  idPrefix?: string;
}) {
  const t = useTranslations("public.stay");
  const tu = useTranslations("public.units");
  const deposit = depositCents(offering, totalCents);
  const info = moneyInfoLines(
    { totalCents, depositCents: deposit, currency, cancelPolicy: offering.cancelPolicy, lines },
    tu,
  );
  if (info.length === 0 && offering.termsText === null) return null;
  const termsId = `${idPrefix}terms-accepted`;
  // moneyInfoLines puts the breakdown lines first, then the total.
  const totalIdx = totalCents === null ? -1 : (lines?.length ?? 0);
  return (
    <div className={cn("flex flex-col gap-2 border-t pt-4 text-sm")}>
      {info.map((l, i) => (
        <p key={l} className={cn("tabular-nums", i === totalIdx ? "font-medium" : "text-muted-foreground")}>
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
