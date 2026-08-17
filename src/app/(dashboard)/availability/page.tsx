import Link from "next/link";
import { getAvailabilityAdmin } from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";
import { StaffTabs } from "@/features/scheduling/components/staff-tabs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const [params, staff, settings] = await Promise.all([
    searchParams,
    listActiveStaff(),
    getSchedulingSettings(),
  ]);
  const timezone = settings?.timezone ?? "UTC";

  // Whose hours are on screen. A shape-checked `?staff=` only counts if it
  // names an active member of this org — anything else (stale link, another
  // org's id, a deactivated person) quietly falls back to the first active
  // one rather than 404ing a page the provider can still use.
  const current = (params.staff && UUID_RE.test(params.staff)
    ? staff.find((s) => s.id === params.staff)
    : undefined) ?? staff[0];

  if (!current) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <p className="text-muted-foreground text-sm">
          Nobody on the team is active right now.{" "}
          <Link href="/team" className="hover:text-foreground underline underline-offset-3">
            Reactivate someone
          </Link>{" "}
          to set hours.
        </p>
      </div>
    );
  }

  const { rules, exceptions } = await getAvailabilityAdmin(current.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Times are shown in {timezone} ·{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Change on Booking page
          </Link>
        </p>
        {/* Solo rule: one active member ⇒ no switcher (StaffTabs renders
            nothing), and this page is identical to the pre-team one. */}
        <StaffTabs
          staff={staff}
          current={current.id}
          hrefFor={(id) => `/availability?staff=${id}`}
        />
      </div>
      <WeeklyHours staffId={current.id} rules={rules} />
      <DateOverrides staffId={current.id} rules={rules} exceptions={exceptions} />
    </div>
  );
}
