import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOffering, listUnitsWithBlackouts, getOrgCurrency } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { UnitsEditor } from "@/features/rentals/components/units-editor";
import { Badge } from "@/components/ui/badge";
import { getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";
import { dateInZone } from "@/features/scheduling/slots";

export default async function RentalDetailPage({ params }: PageProps<"/rentals/[id]">) {
  const { id } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (same idiom as programs/[id]/units/[unitId]).
  if (!z.uuid().safeParse(id).success) notFound();

  const offering = await getOffering(id);
  // RLS hides other orgs' rows — indistinguishable from a nonexistent id,
  // which is exactly the 404 we want.
  if (!offering) notFound();
  const units = await listUnitsWithBlackouts(id);
  const currency = await getOrgCurrency();

  const hourly = offering.rangeMode === "hours";
  const nightly = offering.rangeMode === "nights";

  // H2: hours offerings read opening hours from availability_rules
  // (offering-owned rows, 0056) instead of the nights/days start/end times —
  // same org-timezone idiom as /availability/page.tsx.
  let timezone = "UTC";
  let rules: Awaited<ReturnType<typeof getOfferingAvailabilityAdmin>>["rules"] = [];
  let exceptions: Awaited<ReturnType<typeof getOfferingAvailabilityAdmin>>["exceptions"] = [];
  if (hourly) {
    const settings = await getSchedulingSettings();
    timezone = settings?.timezone ?? "UTC";
    const today = dateInZone(new Date(), timezone);
    ({ rules, exceptions } = await getOfferingAvailabilityAdmin(offering.id, today));
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
          ← Rentals
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{offering.name}</h1>
              <Badge variant="outline">{hourly ? "Hourly" : nightly ? "Nightly" : "Daily"}</Badge>
              {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {hourly
                ? `${formatDurationLabel(offering.minDurationMin!)}–${formatDurationLabel(offering.maxDurationMin!)} · every ${offering.slotIncrementMin} min`
                : nightly
                  ? `check-in ${offering.startTime} · check-out ${offering.endTime}`
                  : `pickup ${offering.startTime} · return ${offering.endTime}`}
            </p>
          </div>
          <OfferingDialog offering={offering} currency={currency} />
        </div>
      </div>
      <UnitsEditor offeringId={offering.id} units={units} />
      {hourly ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">Opening hours</h2>
          <WeeklyHours owner={{ rentalOfferingId: offering.id }} rules={rules} />
          <DateOverrides
            owner={{ rentalOfferingId: offering.id }}
            timeZone={timezone}
            rules={rules}
            exceptions={exceptions}
          />
        </div>
      ) : null}
    </div>
  );
}
