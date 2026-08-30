import { listStatsBookings } from "@/features/scheduling/queries";
import { computeOverviewStats } from "@/features/scheduling/stats";
import { StatTile } from "@/features/scheduling/components/stat-tiles";
import { getSchedulingSettings } from "@/features/orgs/queries";

const DAY_MS = 86_400_000;

export default async function OverviewPage() {
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";
  const now = new Date();
  const rows = await listStatsBookings(new Date(now.getTime() - 90 * DAY_MS).toISOString());
  const stats = computeOverviewStats(rows, now, timeZone);

  const rate =
    stats.cancellationRate === null
      ? "—"
      : `${Math.round(stats.cancellationRate * 100)}%`;
  const busiest =
    stats.busiestWeekday === null || stats.busiestHour === null
      ? "—"
      : `${stats.busiestWeekday} · ${String(stats.busiestHour).padStart(2, "0")}:00`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="This week"
          value={String(stats.weekCount)}
          caption={`vs ${stats.prevWeekCount} last week`}
        />
        <StatTile
          label="This month"
          value={String(stats.monthCount)}
          caption={`vs ${stats.prevMonthCount} last month`}
        />
        <StatTile label="Cancellation rate" value={rate} caption="last 30 days" />
        <StatTile label="Busiest time" value={busiest} caption="last 90 days" />
      </div>
    </div>
  );
}
