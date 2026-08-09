import Link from "next/link";
import type { TemplateListItem } from "@/features/templates/queries";

export function TemplateList({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        No templates yet. Create one to define the stages your rollouts will run.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Stages</th>
            <th className="p-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="hover:bg-muted/50 border-b last:border-0">
              <td className="p-3">
                <Link href={`/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                {t.description ? (
                  <p className="text-muted-foreground truncate text-xs">{t.description}</p>
                ) : null}
              </td>
              <td className="p-3 tabular-nums">{t.stageCount}</td>
              <td className="text-muted-foreground p-3">
                {new Date(t.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
