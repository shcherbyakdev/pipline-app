import { StatTile } from "@/features/scheduling/components/stat-tiles";
import type { BillingOverview } from "../queries";

/* The three numbers a plan can actually run out of (spec §7.7). Limits come
   from the entitlements, never from a literal here — Team's bookable staff is
   the seat count, not the plan default. */
export function UsageMeters({ overview }: { overview: BillingOverview }) {
  const { entitlements: ent, usage } = overview;
  const reminderCap = ent.reminderBookingsPerMonth;
  const serviceCap = ent.publicServices;
  const extraStaff = usage.activeStaff - ent.bookableResources;

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
      <StatTile
        label="Bookable team members"
        value={`${usage.activeStaff} / ${ent.bookableResources}`}
        caption={
          extraStaff > 0
            ? `only the first ${ent.bookableResources} are bookable publicly`
            : "active on your booking page"
        }
      />
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
