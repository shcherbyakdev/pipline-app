import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageIntro } from "@/components/shell/page-header";
import { perkToggle } from "@/lib/billing/badge-toggle";
import { getIntegrationsPage } from "@/features/calendar-sync/queries";
import { GoogleCalendarCard } from "@/features/calendar-sync/components/google-calendar-card";
import { HowItWorks } from "@/features/calendar-sync/components/how-it-works";
import { ConnectNotice } from "@/features/calendar-sync/components/connect-notice";

/* /integrations (spec 2026-09-05 §5): the connected Google accounts and
   what each does. Same frame as Settings and Notifications. */
export default async function IntegrationsPage() {
  const [data, t] = await Promise.all([getIntegrationsPage(), getTranslations("integrations")]);
  const perk = await perkToggle(data.orgId, (ent) => ent.gcalSync);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <Suspense fallback={null}>
        <ConnectNotice />
      </Suspense>
      <PageIntro>{t("intro")}</PageIntro>
      <div className="flex flex-col gap-3">
        <GoogleCalendarCard
          configured={data.configured}
          allowed={perk.allowed}
          upgradeHref={perk.upgradeHref}
          connections={data.connections}
          staff={data.staff}
          offersAppointments={data.offersAppointments}
        />
        <HowItWorks />
      </div>
    </div>
  );
}
