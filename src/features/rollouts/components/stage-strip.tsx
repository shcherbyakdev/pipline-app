import type { RolloutStage } from "@/features/rollouts/queries";

// Read-only by design: a rollout's stages are a frozen snapshot (copy-on-use).
export function StageStrip({ stages }: { stages: RolloutStage[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-sm font-medium">Stages ({stages.length})</h2>
      <ol className="flex flex-wrap items-center gap-1.5">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
          >
            <span className="tabular-nums">{index + 1}.</span> {stage.name}
          </li>
        ))}
      </ol>
    </div>
  );
}
