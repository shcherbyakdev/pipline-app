import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { ServicesList } from "@/features/scheduling/components/services-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageIntro } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateServiceGate } from "@/lib/billing/gates";
import { cn } from "@/lib/utils";

/* Services: the list. Each row opens the service's own page; a new one gets
   a page of its own (or the upgrade door when the plan is full). */
export default async function ServicesPage() {
  const { org } = await requireOrg();
  // Team (multi-staff): the roster comes along so each service can say who
  // offers it. The whole roster, not just the active part — a deactivated
  // person's assignment must not be silently dropped from the count.
  const [services, staff, doorHref, t] = await Promise.all([
    listServices(),
    listStaff(),
    gateHref(org.id, evaluateServiceGate),
    getTranslations("services"),
  ]);
  const newService = (
    <Link href={doorHref ?? "/services/new"} className={cn(buttonVariants({ size: "sm" }), "w-fit")}>
      <Plus className="size-4" /> {t("newButton")}
    </Link>
  );
  // Empty: one composed panel that says what a service is and carries the
  // create action, so the page has exactly one CTA either way.
  if (services.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <EmptyState title={t("emptyTitle")} action={newService}>
          {t("emptyBody")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <PageIntro>{t("intro")}</PageIntro>
        {newService}
      </div>
      <ServicesList services={services} staff={staff} />
    </div>
  );
}
