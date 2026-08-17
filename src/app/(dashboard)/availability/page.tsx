import Link from "next/link";
import { getAvailabilityAdmin } from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";

export default async function AvailabilityPage() {
  const [{ rules, exceptions }, settings] = await Promise.all([
    getAvailabilityAdmin(),
    getSchedulingSettings(),
  ]);
  const timezone = settings?.timezone ?? "UTC";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <p className="text-muted-foreground text-sm">
          Times are shown in {timezone} ·{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Change on Booking page
          </Link>
        </p>
      </div>
      <WeeklyHours rules={rules} />
      <DateOverrides rules={rules} exceptions={exceptions} />
    </div>
  );
}
