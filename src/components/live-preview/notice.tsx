import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

/* One-line note under a live preview: error (unreadable as configured),
   warn (a bet that may not hold), info (how to read the preview). */
export function PreviewNotice({ tone, children }: { tone: "error" | "warn" | "info"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "info" && "text-muted-foreground bg-card",
      )}
    >
      <HugeiconsIcon icon={tone === "info" ? InformationCircleIcon : Alert02Icon} size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}
