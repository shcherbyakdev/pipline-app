import { notFound } from "next/navigation";
import { getRollout } from "@/features/rollouts/queries";
import { RolloutHeader } from "@/features/rollouts/components/rollout-header";
import { StageStrip } from "@/features/rollouts/components/stage-strip";
import { UnitList } from "@/features/rollouts/components/unit-list";

export default async function RolloutDetailPage({ params }: PageProps<"/rollouts/[id]">) {
  const { id } = await params;
  const rollout = await getRollout(id);
  // RLS returns nothing for foreign orgs' rollouts — indistinguishable from a
  // nonexistent id, which is exactly the 404 we want.
  if (!rollout) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <RolloutHeader id={rollout.id} name={rollout.name} templateName={rollout.templateName} />
      <StageStrip stages={rollout.stages} />
      <UnitList rolloutId={rollout.id} units={rollout.units} stages={rollout.stages} />
    </div>
  );
}
