import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrgCurrency, listOfferings } from "@/features/rentals/queries";
import { NewSpaceForm } from "@/features/rentals/components/new-space-form";
import { OFFERING_KINDS, type OfferingKind } from "@/features/rentals/pricing-rules";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateResourceGate } from "@/lib/billing/gates";

/* A new space, on a page of its own (no dialog on the list). The kind
   rides the URL (`?kind=composite|equipment`, from the list's New menu):
   a plain room is the default and never asks. */
export default async function NewRentalPage({ searchParams }: PageProps<"/rentals/new">) {
  const { kind: raw } = await searchParams;
  const kind: OfferingKind = OFFERING_KINDS.find((k) => k === raw) ?? "space";
  const { org } = await requireOrg();
  const [currency, offerings, doorHref, t] = await Promise.all([
    getOrgCurrency(),
    // S6: what a "whole studio" can be built out of — the org's hourly rooms.
    listOfferings(),
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
        <h1 className="text-lg font-semibold">{t(`newTitle.${kind}`)}</h1>
        {kind === "space" ? null : <p className="text-muted-foreground text-sm">{t(`form.kind.${kind}Hint`)}</p>}
      </div>
      <NewSpaceForm
        kind={kind}
        currency={currency}
        rooms={offerings
          .filter((o) => o.rangeMode === "hours" && o.kind === "space")
          .map(({ id, name }) => ({ id, name }))}
      />
    </div>
  );
}
