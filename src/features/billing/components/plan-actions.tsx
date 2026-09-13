"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/features/booking-page/studio/confirm-dialog";
import { cancelPlan, resumePlan, updatePaymentMethod } from "../actions";

/* The doors out of the current plan, in our own styling: cancel, resume, and
   the one hop that stays hosted (the card form — Managed Payments doesn't
   allow a card field of ours to exist).

   Cancel asks first. It is reversible right up to the period end — Resume is
   this same row — but it is still money, and the confirmation is where the
   "your plan runs until <date>" promise is made.

   Resume and Payment method are plain forms so they work without JS; cancel
   can't be, because the dialog is the confirmation. */
export function PlanActions({ cancelling, endsOn }: { cancelling: boolean; endsOn: string | null }) {
  const t = useTranslations("billing.current");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={updatePaymentMethod}>
        <Button type="submit" variant="secondary" size="sm">
          {t("paymentMethod")}
        </Button>
      </form>
      {cancelling ? (
        <form action={resumePlan}>
          <Button type="submit" variant="secondary" size="sm">
            {t("resume")}
          </Button>
        </form>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setConfirming(true)}
          >
            {t("cancel")}
          </Button>
          <ConfirmDialog
            open={confirming}
            destructive
            title={t("cancelTitle")}
            description={endsOn ? t("cancelUntil", { date: endsOn }) : t("cancelNow")}
            confirmLabel={t("cancelConfirm")}
            cancelLabel={t("keep")}
            onClose={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              startTransition(() => cancelPlan());
            }}
          />
        </>
      )}
    </div>
  );
}
