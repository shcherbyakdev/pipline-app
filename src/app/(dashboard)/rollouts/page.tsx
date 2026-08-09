import { listRollouts } from "@/features/rollouts/queries";
import { listTemplates } from "@/features/templates/queries";
import { RolloutList } from "@/features/rollouts/components/rollout-list";
import { CreateRolloutDialog } from "@/features/rollouts/components/create-rollout-dialog";

export default async function RolloutsPage() {
  const [rollouts, templates] = await Promise.all([listRollouts(), listTemplates()]);
  const templateOptions = templates.map((t) => ({
    id: t.id,
    name: t.name,
    stageCount: t.stageCount,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Rollouts</h1>
        <CreateRolloutDialog templates={templateOptions} />
      </div>
      <RolloutList rollouts={rollouts} />
    </div>
  );
}
