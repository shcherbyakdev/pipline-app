import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrgCurrency } from "@/features/rentals/queries";
import { OfferingForm } from "@/features/rentals/components/offering-form";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateResourceGate } from "@/lib/billing/gates";

/* A new space, on a page of its own (no dialog on the list). */
export default async function NewRentalPage() {
  const { org } = await requireOrg();
  const [currency, doorHref, t] = await Promise.all([
    getOrgCurrency(),
    gateHref(org.id, evaluateResourceGate),
    getTranslations("spaces"),
  ]);
  // Same gate as the list's button: a capped org never sees a form the
  // action would only refuse.
  if (doorHref) redirect(doorHref);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
          {t("back")}
        </Link>
        <h1 className="text-lg font-semibold">{t("newButton")}</h1>
      </div>
      <OfferingForm currency={currency} />
    </div>
  );
}
