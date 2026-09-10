import * as React from "react";
import { ChevronRight } from "lucide-react";

/* One settings row on the space page: closed, it reads its saved values as
   a sentence; open, it is the editor. Native <details>, so closed fields
   stay in the DOM and a surrounding form still submits them. Shared by the
   settings form's rows and the units/blackouts row beside them. */
export function SettingsSection({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{summary}</span>
        </span>
        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-4 pt-2 pb-5">{children}</div>
    </details>
  );
}
