"use client";

import Link from "next/link";

// A dot is a toggle only while its stage has no requirements. Requirement-
// bearing stages derive their status, so the dot becomes a link into the
// unit page's stage section instead of a claim you can click into existence.
export function StageDots({
  stages,
  onToggle,
}: {
  stages: { unitStageId: string; name: string; done: boolean; href: string | null }[];
  onToggle: (unitStageId: string, done: boolean) => void;
}) {
  const dotClass = (done: boolean) =>
    done
      ? "size-3.5 rounded-full bg-primary transition-colors"
      : "border-input size-3.5 rounded-full border bg-transparent transition-colors hover:border-primary";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {stages.map((s) =>
        s.href !== null ? (
          <Link
            key={s.unitStageId}
            href={s.href}
            aria-label={`Open ${s.name}`}
            title={`Open ${s.name}`}
            className={`block ${dotClass(s.done)}`}
          />
        ) : (
          <button
            key={s.unitStageId}
            type="button"
            aria-label={s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`}
            aria-pressed={s.done}
            title={s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`}
            onClick={() => onToggle(s.unitStageId, !s.done)}
            className={dotClass(s.done)}
          />
        ),
      )}
    </div>
  );
}
