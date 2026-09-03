import { cn } from "@/lib/utils";
import type { GhostKey, RenderContext } from "./context";

/* Placeholder for an empty field — preview only. The public page renders
   nothing for it (publicSections already dropped fully empty sections). The
   words come from the studio's chrome (ctx.preview), never from this
   subtree's provider, which speaks the org's language. */
export function Ghost({ ctx, text, kind = "text" }: { ctx: Pick<RenderContext, "mode" | "preview">; text: GhostKey; kind?: "text" | "image" }) {
  const label = ctx.preview?.ghost[text];
  if (ctx.mode !== "preview" || !label) return null;
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
