import { getTranslations } from "next-intl/server";
import { StatTile } from "@/features/scheduling/components/stat-tiles";
import { resourceMeter } from "../resource-usage";
import type { BillingOverview } from "../queries";

/* The three numbers a plan can actually run out of (spec §7.7). Limits come
   from the entitlements, never from a literal here — Team's bookable resources
   is the seat count, not the plan default. */
export async function UsageMeters({ overview }: { overview: BillingOverview }) {
  const t = await getTranslations("billing");
  const { entitlements: ent, usage } = overview;
  const reminderCap = ent.reminderBookingsPerMonth;
  const serviceCap = ent.publicServices;
  const resources = resourceMeter(t, usage, overview.mode, ent);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label={t("usage.reminders")}
        value={reminderCap === null ? String(usage.bookingsThisMonth) : `${usage.bookingsThisMonth} / ${reminderCap}`}
        caption={
          reminderCap === null
            ? t("usage.everyBookingReminded")
            : usage.bookingsThisMonth >= reminderCap
              ? t("usage.remindersResume")
              : t("usage.confirmationsAlways")
        }
      />
      <StatTile label={t("usage.resources")} value={resources.value} caption={resources.caption} />
      <StatTile
        label={t("usage.services")}
        value={serviceCap === null ? String(usage.services) : `${usage.services} / ${serviceCap}`}
        caption={
          serviceCap === null
            ? t("usage.unlimitedServices")
            : usage.services > serviceCap
              ? t("usage.firstServicesPublic", { count: serviceCap })
              : t("usage.servicesPublic")
        }
      />
    </div>
  );
}
