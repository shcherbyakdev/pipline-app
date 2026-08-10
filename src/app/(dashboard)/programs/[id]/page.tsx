import { notFound } from "next/navigation";
import { getProgram } from "@/features/programs/queries";
import { ProgramHeader } from "@/features/programs/components/program-header";
import { StageStrip } from "@/features/programs/components/stage-strip";
import { UnitList } from "@/features/programs/components/unit-list";
import { listParticipants, listProgramLinks } from "@/features/participants/queries";
import { LinksPanel } from "@/features/participants/components/links-panel";

export default async function ProgramDetailPage({ params }: PageProps<"/programs/[id]">) {
  const { id } = await params;
  const [program, participants, links] = await Promise.all([
    getProgram(id),
    listParticipants(),
    listProgramLinks(id),
  ]);
  // RLS returns nothing for foreign orgs' programs — indistinguishable from a
  // nonexistent id, which is exactly the 404 we want.
  if (!program) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <ProgramHeader id={program.id} name={program.name} templateName={program.templateName} />
      <StageStrip stages={program.stages} />
      <UnitList programId={program.id} units={program.units} stages={program.stages} participants={participants} />
      <LinksPanel
        programId={program.id}
        participants={participants}
        units={program.units.map((u) => ({ id: u.id, name: u.name }))}
        links={links}
      />
    </div>
  );
}
