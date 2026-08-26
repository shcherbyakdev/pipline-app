import { StatTile } from "@/features/scheduling/components/stat-tiles";
import { resourceMeter } from "../resource-usage";
import type { BillingOverview } from "../queries";

/* The three numbers a plan can actually run out of (spec §7.7). Limits come
   from the entitlements, never from a literal here — Team's bookable resources
   is the seat count, not the plan default. */
export function UsageMeters({ overview }: { overview: BillingOverview }) {
  const { entitlements: ent, usage } = overview;
  const reminderCap = ent.reminderBookingsPerMonth;
  const serviceCap = ent.publicServices;
  const resources = resourceMeter(usage, overview.mode, ent);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="Reminder bookings this month"
        value={reminderCap === null ? String(usage.bookingsThisMonth) : `${usage.bookingsThisMonth} / ${reminderCap}`}
        caption={
          reminderCap === null
            ? "every booking gets a reminder"
            : usage.bookingsThisMonth >= reminderCap
              ? "reminders resume next month"
              : "confirmations always send"
        }
      />
      <StatTile label="Bookable resources" value={resources.value} caption={resources.caption} />
      <StatTile
        label="Services"
        value={serviceCap === null ? String(usage.services) : `${usage.services} / ${serviceCap}`}
        caption={
          serviceCap === null
            ? "unlimited on your plan"
            : usage.services > serviceCap
              ? `only the first ${serviceCap} are offered publicly`
              : "offered on your booking page"
        }
      />
    </div>
  );
}
