import Link from "next/link";
import type { RolloutListItem } from "@/features/rollouts/queries";

export function RolloutList({ rollouts }: { rollouts: RolloutListItem[] }) {
  if (rollouts.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        No rollouts yet. Create one from a template to start tracking units.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Template</th>
            <th className="p-3 font-medium">Stages</th>
            <th className="p-3 font-medium">Units</th>
            <th className="p-3 font-medium">Progress</th>
            <th className="p-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {rollouts.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50 border-b last:border-0">
              <td className="p-3">
                <Link href={`/rollouts/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
              </td>
              <td className="text-muted-foreground p-3">{r.templateName ?? "—"}</td>
              <td className="p-3 tabular-nums">{r.stageCount}</td>
              <td className="p-3 tabular-nums">{r.unitCount}</td>
              <td className="text-muted-foreground p-3 tabular-nums">
                {r.totalCount === 0 ? "—" : `${Math.round((r.doneCount / r.totalCount) * 100)}%`}
              </td>
              <td className="text-muted-foreground p-3">
                {new Date(r.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
