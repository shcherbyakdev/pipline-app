"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { moneyInfoLines, totalCents, depositCents, type MoneyFields } from "@/features/rentals/pricing";

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
  const total = units === null ? null : totalCents(offering, units);
  const deposit = depositCents(offering, total);
  const lines = moneyInfoLines({
    totalCents: total,
    depositCents: deposit,
    currency,
    cancelWindowMin: offering.cancelWindowMin,
  });
  if (lines.length === 0 && offering.termsText === null) return null;
  const termsId = `${idPrefix}terms-accepted`;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      {lines.map((l) => (
        <p key={l} className={l.startsWith("Total") ? "font-medium" : "text-muted-foreground"}>
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
              I accept the terms
            </Label>
          </div>
          <details className="ml-6">
            <summary className="text-muted-foreground cursor-pointer text-xs">Show terms</summary>
            <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{offering.termsText}</p>
          </details>
        </div>
      ) : null}
    </div>
  );
}
