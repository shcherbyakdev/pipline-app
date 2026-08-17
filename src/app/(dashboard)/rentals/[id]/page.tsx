import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOffering, listUnitsWithBlackouts } from "@/features/rentals/queries";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { UnitsEditor } from "@/features/rentals/components/units-editor";
import { Badge } from "@/components/ui/badge";

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

  const nightly = offering.rangeMode === "nights";

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
              <Badge variant="outline">{nightly ? "Nightly" : "Daily"}</Badge>
              {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {nightly
                ? `check-in ${offering.startTime} · check-out ${offering.endTime}`
                : `pickup ${offering.startTime} · return ${offering.endTime}`}
              {offering.priceLabel ? ` · ${offering.priceLabel}` : ""}
            </p>
          </div>
          <OfferingDialog offering={offering} />
        </div>
      </div>
      <UnitsEditor offeringId={offering.id} units={units} />
    </div>
  );
}
