import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageIntro } from "@/components/shell/page-header";
import { getPaymentsPage } from "@/features/payments/queries";
import { StripeCard } from "@/features/payments/components/stripe-card";
import { PaymentSettingsForm } from "@/features/payments/components/payment-settings-form";
import { PaymentsNotice } from "@/features/payments/components/payments-notice";

/* /payments (spec §Admin): the studio's money rail, the hold window and the
   legal identity the public footer prints. Same frame as Integrations. */
export default async function PaymentsPage() {
  const [data, t] = await Promise.all([getPaymentsPage(), getTranslations("payments")]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <Suspense fallback={null}><PaymentsNotice /></Suspense>
      <PageIntro>{t("intro")}</PageIntro>
      <div className="flex flex-col gap-3">
        <StripeCard data={data} />
        <PaymentSettingsForm holdMin={data.holdMin} legal={data.legal} />
      </div>
    </div>
  );
}
