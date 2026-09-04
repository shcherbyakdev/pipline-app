import { getTranslations } from "next-intl/server";
import { PageIntro } from "@/components/shell/page-header";
import { perkToggle } from "@/lib/billing/badge-toggle";
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
  const lead = await perkToggle(settings.orgId, (ent) => ent.customReminders);
  // "On Free, reminders go to the first N bookings each month." off the same
  // plan read; null while plans are not enforced (or unlimited).
  const quota = lead.entitlements?.reminderBookingsPerMonth ?? null;
  const quotaHint = quota === null ? null : t("reminders.quotaFree", { count: quota });
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
