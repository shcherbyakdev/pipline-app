import { listPrograms } from "@/features/programs/queries";
import { listTemplates } from "@/features/templates/queries";
import { ProgramList } from "@/features/programs/components/program-list";
import { CreateProgramDialog } from "@/features/programs/components/create-program-dialog";

export default async function ProgramsPage() {
  const [programs, templates] = await Promise.all([listPrograms(), listTemplates()]);
  const templateOptions = templates.map((t) => ({
    id: t.id,
    name: t.name,
    stageCount: t.stageCount,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Programs</h1>
        <CreateProgramDialog templates={templateOptions} />
      </div>
      <ProgramList programs={programs} />
    </div>
  );
}
