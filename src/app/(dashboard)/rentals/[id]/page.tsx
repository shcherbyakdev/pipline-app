import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOffering, listUnitsWithBlackouts, getOrgCurrency } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { UnitsEditor } from "@/features/rentals/components/units-editor";
import { Badge } from "@/components/ui/badge";
import { getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { summarizeWeekly } from "@/features/scheduling/hours-summary";
import { ownerHref } from "@/features/scheduling/availability-owner";

export default async function RentalDetailPage({ params }: PageProps<"/rentals/[id]">) {
  const [t, tc, tu] = await Promise.all([
    getTranslations("spaces"),
    getTranslations("common"),
    getTranslations("public.units"),
  ]);
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

  // U3 (ruling 4): hours are edited on /availability; this page only
  // summarises the weekly rules. Overrides are not shown here, so the
  // exceptions half of the read is discarded and no timezone is needed.
  const rules = hourly ? (await getOfferingAvailabilityAdmin(offering.id)).rules : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
          {t("back")}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{offering.name}</h1>
              <Badge variant="outline">{t(`mode.${offering.rangeMode}`)}</Badge>
              {!offering.active ? <Badge variant="outline">{tc("inactive")}</Badge> : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {hourly
                ? t("schedule.hours", {
                    min: formatDurationLabel(offering.minDurationMin!, tu),
                    max: formatDurationLabel(offering.maxDurationMin!, tu),
                    step: offering.slotIncrementMin!,
                  })
                : t(`schedule.${offering.rangeMode}`, { start: offering.startTime!, end: offering.endTime! })}
            </p>
          </div>
          <OfferingDialog offering={offering} currency={currency} />
        </div>
      </div>
      <UnitsEditor offeringId={offering.id} units={units} />
      {hourly ? (
        <section
          aria-labelledby="opening-hours"
          className="border-border flex items-start justify-between gap-4 rounded-lg border p-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="opening-hours" className="text-sm font-medium">
              {t("detail.openingHours")}
            </h2>
            <p className="text-muted-foreground text-sm">{summarizeWeekly(rules)}</p>
          </div>
          {/* /availability lists ACTIVE hourly spaces only, so an inactive
              one would silently land on another owner's hours — say so
              instead of linking. */}
          {offering.active ? (
            <Link
              href={ownerHref({ kind: "space", id: offering.id })}
              className="hover:text-foreground shrink-0 text-sm underline underline-offset-3"
            >
              {t("detail.editHours")}
            </Link>
          ) : (
            <span className="text-muted-foreground shrink-0 text-sm">{t("detail.reactivateToEdit")}</span>
          )}
        </section>
      ) : null}
    </div>
  );
}
