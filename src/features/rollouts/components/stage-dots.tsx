"use client";

export function StageDots({
  stages,
  onToggle,
}: {
  stages: { unitStageId: string; name: string; done: boolean }[];
  onToggle: (unitStageId: string, done: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {stages.map((s) => {
        const label = s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`;
        return (
          <button
            key={s.unitStageId}
            type="button"
            aria-label={label}
            aria-pressed={s.done}
            title={label}
            onClick={() => onToggle(s.unitStageId, !s.done)}
            className={
              s.done
                ? "size-3.5 rounded-full bg-primary transition-colors"
                : "border-input size-3.5 rounded-full border bg-transparent transition-colors hover:border-primary"
            }
          />
        );
      })}
    </div>
  );
}
