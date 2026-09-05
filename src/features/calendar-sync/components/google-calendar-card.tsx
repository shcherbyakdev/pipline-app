import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings-row";
import { PremiumChip } from "@/features/billing/components/premium-chip";
import type { Connection } from "../connections";
import { ConnectionRow } from "./connection-row";
import { ConnectLink } from "./connect-link";

/* The Google Calendar card (spec 2026-09-05 §5 "Page"). Server component;
   the states in order: not set up on this server · a paid perk the plan
   lacks · nothing connected · the connected accounts, each its own row,
   with "Connect another" under them. The Connect button is a plain link
   to the OAuth start route (connect-link.tsx) — a navigation, not an action. */
export async function GoogleCalendarCard({
  configured,
  allowed,
  upgradeHref,
  connections,
  staff,
  offersAppointments,
}: {
  configured: boolean;
  allowed: boolean;
  upgradeHref: string | null;
  connections: Connection[];
  staff: { id: string; name: string }[];
  offersAppointments: boolean;
}) {
  const t = await getTranslations("integrations.google");
  const connect = (label: string) => <ConnectLink label={label} />;

  let body: React.ReactNode;
  if (!configured) {
    body = <p className="text-muted-foreground px-4 py-3 text-xs">{t("notConfigured")}</p>;
  } else if (!allowed) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-muted-foreground text-xs">{connections.length ? t("paused") : t("proOnly")}</p>
        <PremiumChip id="gcal-plan" href={upgradeHref} label={t("proChip")} />
      </div>
    );
  } else if (connections.length === 0) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-muted-foreground text-xs">{t("notConnected")}</p>
        {connect(t("connect"))}
      </div>
    );
  } else {
    body = (
      <>
        {connections.map((c) => (
          <ConnectionRow key={c.id} connection={c} staff={staff} showStaff={offersAppointments && staff.length >= 2} />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-muted-foreground text-xs">{t("anotherHint")}</p>
          {connect(t("connectAnother"))}
        </div>
      </>
    );
  }

  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      {body}
    </SettingsCard>
  );
}
