import { cn } from "@/lib/utils";

/* The soft world's empty state: a quiet dashed panel that says what this
   thing is and, when there is one, carries the action that creates the
   first one — so an empty page teaches instead of trailing off. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  /** One or two short sentences: what this is, why it matters. */
  children: React.ReactNode;
  /** The create action (usually the page's dialog trigger). */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-input flex flex-col items-center gap-1.5 rounded-2xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
