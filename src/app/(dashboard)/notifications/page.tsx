import { getTranslations } from "next-intl/server";
import { PageIntro } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/queries";
import { perkToggle } from "@/lib/billing/badge-toggle";
import { plansEnforced } from "@/lib/flags";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getNotificationSettings } from "@/features/notifications/queries";
import { vapidPublicKey } from "@/features/notifications/push";
import { PushDevices } from "@/features/notifications/components/push-devices";
import { EventMatrix } from "@/features/notifications/components/event-matrix";
import { ReminderSettings } from "@/features/notifications/components/reminder-settings";
import { AlwaysSent } from "@/features/notifications/components/always-sent";

/* /notifications (spec 2026-09-05 §6): what the person hears about (push
   devices, the event × channel grid) and what their clients receive
   (reminders, the always-sent list). Same frame as Settings. */
export default async function NotificationsPage() {
  const [settings, t] = await Promise.all([getNotificationSettings(), getTranslations("notifications")]);
  const { orgId } = settings;
  const [lead, quotaHint] = await Promise.all([
    perkToggle(orgId, (ent) => ent.customReminders),
    reminderQuotaHint(orgId, (count) => t("reminders.quotaFree", { count })),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <PageIntro>{t("intro")}</PageIntro>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.you")}</h2>
        <PushDevices publicKey={vapidPublicKey()} devices={settings.devices} />
        <EventMatrix prefs={settings.member} />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">{t("sections.clients")}</h2>
        <ReminderSettings prefs={settings.org} canCustomize={lead.allowed} upgradeHref={lead.upgradeHref} quotaHint={quotaHint} />
        <AlwaysSent />
      </div>
    </div>
  );
}

/** "On Free, reminders go to the first N bookings each month." while the
    plan meters them; null otherwise. Fails to null: a hint is decoration. */
async function reminderQuotaHint(orgId: string, line: (count: number) => string): Promise<string | null> {
  try {
    if (!plansEnforced(await getDashboardFlags(orgId))) return null;
    const ent = await getEntitlements(orgId, await createClient());
    return ent.reminderBookingsPerMonth === null ? null : line(ent.reminderBookingsPerMonth);
  } catch (error) {
    console.error("[notifications] quota hint read failed:", error);
    return null;
  }
}
