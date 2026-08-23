import { cn } from "@/lib/utils";

/* Placeholder for an empty field — preview only. The public page renders
   nothing for it (publicSections already dropped fully empty sections). */
export function Ghost({ mode, label, kind = "text" }: { mode: "public" | "preview"; label: string; kind?: "text" | "image" }) {
  if (mode !== "preview") return null;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[var(--widget-radius)] border border-dashed text-sm opacity-60",
        kind === "image" ? "aspect-[16/9] w-full" : "px-3 py-2",
      )}
    >
      {label}
    </div>
  );
}
