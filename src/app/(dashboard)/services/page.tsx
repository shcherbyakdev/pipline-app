import { getTranslations } from "next-intl/server";
import { listServices } from "@/features/scheduling/queries";
import { listStaff } from "@/features/scheduling/staff-queries";
import { ServicesList } from "@/features/scheduling/components/services-list";
import { ServiceDialog } from "@/features/scheduling/components/service-dialog";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { PageIntro } from "@/components/shell/page-header";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { evaluateServiceGate } from "@/lib/billing/gates";
import { hrefForHint } from "@/lib/billing/upgrade-path";
import { env } from "@/env";

/** Team page idiom: ask the gate createService asks, and send a capped org
    to the door rather than into a form that would be refused. */
async function addGateHref(orgId: string): Promise<string | null> {
  const flags = await getDashboardFlags(orgId);
  if (!plansEnforced(flags)) return null;
  const refused = await evaluateServiceGate(orgId, await createClient(), flags);
  return refused ? hrefForHint(refused.how) : null;
}

export default async function ServicesPage() {
  const { org } = await requireOrg();
  const t = await getTranslations("services");
  // Team (multi-staff): the roster comes along so each service can say who
  // offers it. The whole roster, not just the active part — an edit must not
  // silently drop a deactivated person's assignment.
  const [services, staff, settings, gateHref] = await Promise.all([
    listServices(),
    listStaff(),
    getSchedulingSettings(),
    addGateHref(org.id),
  ]);
  // Copy-link buttons need the public address; before the org picks a handle
  // there is nothing to copy (spec §5: hidden when there is no handle).
  const linkBase = settings?.handle ? { appUrl: env.NEXT_PUBLIC_APP_URL, handle: settings.handle } : null;
  // Empty: one composed panel that says what a service is and carries the
  // create action, so the page has exactly one CTA either way.
  if (services.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <EmptyState title={t("emptyTitle")} action={<ServiceDialog staff={staff} gateHref={gateHref} />}>
          {t("emptyBody")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <PageIntro>{t("intro")}</PageIntro>
        <ServiceDialog staff={staff} gateHref={gateHref} />
      </div>
      <ServicesList services={services} staff={staff} linkBase={linkBase} />
    </div>
  );
}
