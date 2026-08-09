import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getUnit } from "@/features/programs/queries";
import { UnitStageSections } from "@/features/programs/components/unit-stage-sections";

export default async function UnitDetailPage({
  params,
}: PageProps<"/programs/[id]/units/[unitId]">) {
  const { id, unitId } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (settles the deferred uuid-404 follow-up for this route).
  const uuid = z.uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(unitId).success) notFound();

  const unit = await getUnit(id, unitId);
  // RLS hides foreign rows — indistinguishable from a nonexistent id.
  if (!unit) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/programs/${unit.programId}`}
          className="text-muted-foreground w-fit text-xs hover:underline"
        >
          ← {unit.programName}
        </Link>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
      </div>
      <UnitStageSections sections={unit.stages} />
    </div>
  );
}
