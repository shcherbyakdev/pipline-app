import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { listOfferings, getOrgCurrency } from "@/features/rentals/queries";
import { OfferingsList } from "@/features/rentals/components/offerings-list";
import { NewSpaceMenu } from "@/features/rentals/components/new-space-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { PageIntro } from "@/components/shell/page-header";
import { PageActions } from "@/components/shell/page-actions";
import { buttonVariants } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateResourceGate } from "@/lib/billing/gates";
import { cn } from "@/lib/utils";

/* Spaces: the list. Each row opens the space's own page; a new one gets a
   page of its own (or the upgrade door when the plan is full). */
export default async function RentalsPage() {
  const { org } = await requireOrg();
  const [offerings, currency, doorHref, t] = await Promise.all([
    listOfferings(),
    getOrgCurrency(),
    // A new space is a new unit, which spends the plan's resource budget —
    // the same gate createOffering asks.
    gateHref(org.id, evaluateResourceGate),
    getTranslations("spaces"),
  ]);
  // Linear's header action: quiet until hovered. The empty state keeps the
  // solid pill — there the button is the page's only CTA. Once an hourly
  // room exists the button grows a menu (room / whole studio / equipment);
  // until then — and behind the plan door — it is a plain link.
  const hasRoom = offerings.some((o) => o.rangeMode === "hours" && o.kind === "space");
  const newSpace = (v: Parameters<typeof buttonVariants>[0]) =>
    hasRoom && !doorHref ? (
      <NewSpaceMenu {...v} />
    ) : (
      <Link href={doorHref ?? "/rentals/new"} className={cn(buttonVariants(v), "w-fit")}>
        <Plus className="size-4" /> {t("newButton")}
      </Link>
    );
  // Empty: one composed panel that says what a space is and carries the
  // create action, so the page has exactly one CTA either way.
  if (offerings.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <EmptyState title={t("emptyTitle")} action={newSpace({ size: "sm" })}>
          {t("empty")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageActions>{newSpace({ variant: "ghost" })}</PageActions>
      <PageIntro>{t("intro")}</PageIntro>
      <OfferingsList offerings={offerings} currency={currency} />
    </div>
  );
}
