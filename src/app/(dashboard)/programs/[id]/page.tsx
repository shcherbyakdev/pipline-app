import { notFound } from "next/navigation";
import { z } from "zod";
import { getProgram } from "@/features/programs/queries";
import { ProgramHeader } from "@/features/programs/components/program-header";
import { StageStrip } from "@/features/programs/components/stage-strip";
import { UnitList } from "@/features/programs/components/unit-list";
import { listParticipants, listProgramLinks } from "@/features/participants/queries";
import { LinksPanel } from "@/features/participants/components/links-panel";
import { listClientOptions } from "@/features/clients/queries";
import { getProgramChases } from "@/features/chasing/queries";
import { ChasePanel } from "@/features/chasing/components/chase-panel";

export default async function ProgramDetailPage({ params }: PageProps<"/programs/[id]">) {
  const { id } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (22P02) — units/[unitId]/page.tsx idiom.
  if (!z.uuid().safeParse(id).success) notFound();
  const [program, participants, links, clients, chases] = await Promise.all([
    getProgram(id),
    listParticipants(),
    listProgramLinks(id),
    listClientOptions(),
    getProgramChases(id),
  ]);
  // RLS returns nothing for foreign orgs' programs — indistinguishable from a
  // nonexistent id, which is exactly the 404 we want.
  if (!program) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <ProgramHeader id={program.id} name={program.name} templateName={program.templateName} />
      <StageStrip stages={program.stages} />
      <UnitList
        programId={program.id}
        units={program.units}
        stages={program.stages}
        participants={participants}
        clients={clients}
      />
      <LinksPanel
        programId={program.id}
        participants={participants}
        units={program.units.map((u) => ({ id: u.id, name: u.name }))}
        links={links}
      />
      <ChasePanel
        programId={program.id}
        participants={participants}
        units={program.units.map((u) => ({ id: u.id, name: u.name }))}
        chases={chases}
      />
    </div>
  );
}
