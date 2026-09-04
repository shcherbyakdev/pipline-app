import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings-row";

/* The client mails nobody can switch off (spec 2026-09-05 §3.4): they carry
   the booking's manage link and are the client's record. Listed so the
   person sees the whole picture and does not hunt for a switch. */
export async function AlwaysSent() {
  const t = await getTranslations("notifications.alwaysSent");
  const rows = ["confirmation", "request", "cancelled", "rescheduled", "manageLink"] as const;
  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      <ul className="flex flex-col divide-y">
        {rows.map((key) => (
          <li key={key} className="text-muted-foreground px-4 py-2.5 text-xs">
            {t(key)}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
