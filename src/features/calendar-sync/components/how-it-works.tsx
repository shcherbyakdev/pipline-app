import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings-row";

/* Three plain lines so nobody has to guess what the connection does —
   including the one thing it does NOT do (edits in Google stay in Google). */
export async function HowItWorks() {
  const t = await getTranslations("integrations.how");
  return (
    <SettingsCard title={t("title")}>
      {(["push", "busy", "record"] as const).map((k) => (
        <p key={k} className="text-muted-foreground px-4 py-2.5 text-xs">
          {t(k)}
        </p>
      ))}
    </SettingsCard>
  );
}
